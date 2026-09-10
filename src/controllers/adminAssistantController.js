const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const crypto = require('../utils/crypto');
const auditService = require('../services/auditService');
const assistantConfigService = require('../services/assistantConfigService');
const assistantConfigRepository = require('../repositories/assistantConfigRepository');
const assistantModelCatalog = require('../services/assistantModelCatalog');
const assistantModelsRateLimiter = require('../services/assistantModelsRateLimiter');
const assistantProviderTest = require('../services/assistantProviderTest');
const toolRegistry = require('../services/assistant/toolRegistry');
const { settingsSchema, providerConfigSchema, promptSchema, toolOverrideSchema } = require('../validators/assistantValidators');

// Konfigurasi asisten adalah urusan operator platform, bukan Customer Admin: satu prompt yang
// salah berlaku untuk SEMUA pelanggan di connection itu. Gerbangnya requirePlatformAdmin di route.

// encrypted_api_key tidak pernah dikembalikan, dalam bentuk apa pun -- termasuk sebagai panjangnya
// atau empat karakter terakhirnya. Yang perlu diketahui admin hanya apakah kuncinya sudah diisi.
function toSettingsDto(row) {
  if (!row) return null;
  const { encrypted_api_key: encryptedApiKey, ...rest } = row;
  return { ...rest, has_api_key: Boolean(encryptedApiKey) };
}

const listSettings = asyncHandler(async (req, res) => {
  const rows = await assistantConfigRepository.listSettings();
  res.json(rows.map(toSettingsDto));
});

const saveSettings = asyncHandler(async (req, res) => {
  const body = settingsSchema.parse(req.body);
  const { odoo_connection_id: odooConnectionId, api_key: apiKey, ...patch } = body;

  // CR-049. `provider_activated_at` ditulis HANYA saat nilainya benar-benar berpindah. Halaman
  // ini menyimpan settings untuk banyak alasan (toggle aktif/mati, kuota, temperature); memakai
  // updated_at sebagai "sejak kapan provider ini dipakai" akan menampilkan tanggal yang salah
  // dengan penuh percaya diri setiap kali salah satu dari itu disentuh.
  if (patch.provider !== undefined) {
    const { global, connection } = await assistantConfigRepository.findSettings(odooConnectionId || null);
    const current = odooConnectionId ? connection : global;
    if (current?.provider !== patch.provider) patch.provider_activated_at = new Date();
  }

  // `api_key: null` berarti "hapus kuncinya", `undefined` berarti "jangan sentuh". Membedakan
  // keduanya penting: tanpa itu, menyimpan perubahan model akan diam-diam menghapus API key.
  if (apiKey !== undefined) {
    patch.encrypted_api_key = apiKey === null || apiKey === '' ? null : crypto.encrypt(apiKey);
  }

  const saved = await assistantConfigRepository.upsertSettings(odooConnectionId || null, patch, req.user.id);

  // Invalidasi eksplisit, jangan menunggu TTL 60 detik: admin yang baru menekan Simpan akan
  // langsung menguji perubahannya, dan "belum berlaku, tunggu sebentar" tidak bisa dibedakan
  // dari "penyimpanan gagal".
  assistantConfigService.invalidate(odooConnectionId || null);

  await auditService.record(req, {
    action: 'assistant.settings_updated',
    targetType: 'assistant_settings',
    targetId: saved.id,
    metadata: { odooConnectionId: odooConnectionId || null, apiKeyChanged: apiKey !== undefined },
  });
  res.json(toSettingsDto(saved));
});

// Konfigurasi Provider AI (My Account > Setting) -- satu baris per provider, terpisah dari
// listSettings/saveSettings di atas yang hanya menyimpan provider AKTIF + parameter bersama.
// Sama pola toSettingsDto: kedua kunci terenkripsi tidak pernah dikembalikan dalam bentuk apa
// pun, hanya sebagai boolean "sudah diisi atau belum".
function toProviderConfigDto(row) {
  if (!row) return null;
  const { encrypted_api_key: encryptedApiKey, encrypted_api_key_cloud: encryptedApiKeyCloud, ...rest } = row;
  return { ...rest, has_api_key: Boolean(encryptedApiKey), has_api_key_cloud: Boolean(encryptedApiKeyCloud) };
}

const listProviderConfigs = asyncHandler(async (req, res) => {
  const rows = await assistantConfigRepository.listProviderConfigs(null);
  res.json(rows.map(toProviderConfigDto));
});

const saveProviderConfig = asyncHandler(async (req, res) => {
  const body = providerConfigSchema.parse(req.body);
  const { provider, api_key: apiKey, api_key_cloud: apiKeyCloud, ...patch } = body;

  // Sama semantik saveSettings: undefined = jangan sentuh, null/'' = hapus kuncinya. Tanpa
  // pembedaan ini, menyimpan perubahan model akan diam-diam menghapus API key yang sudah ada.
  if (apiKey !== undefined) {
    patch.encrypted_api_key = apiKey === null || apiKey === '' ? null : crypto.encrypt(apiKey);
  }
  if (apiKeyCloud !== undefined) {
    patch.encrypted_api_key_cloud = apiKeyCloud === null || apiKeyCloud === '' ? null : crypto.encrypt(apiKeyCloud);
  }

  const saved = await assistantConfigRepository.upsertProviderConfig(null, provider, patch, req.user.id);

  // Provider config saat ini scope global saja (mengikuti keputusan Fase 1 yang sama untuk
  // assistant_settings di halaman ini -- lihat komentar AssistantAdminPage.jsx), jadi
  // invalidate(null) selalu cukup: tidak ada baris per-connection untuk provider config.
  assistantConfigService.invalidate(null);
  // CR-048: kunci/base URL yang baru berarti daftar model yang berbeda. Tanpa ini admin yang
  // barusan membetulkan API key-nya masih melihat daftar cadangan sampai 10 menit ke depan, dan
  // menyimpulkan kuncinya masih salah.
  assistantModelCatalog.invalidate(provider);
  // BUG-33 (temuan `/code-review`). Hasil Test Connection lama menjelaskan konfigurasi LAMA. Kunci
  // atau base URL yang baru saja ditempel bisa saja salah, dan tanpa ini kartunya mewarisi badge
  // hijau "Terhubung" dari pemeriksaan sebelumnya -- bentuk kebohongan yang persis sama dengan
  // BUG-30, hanya di halaman yang berbeda. Dikosongkan supaya kembali ke "Belum diuji" sampai
  // benar-benar diuji lagi.
  const cleared = await assistantConfigRepository.recordProviderHealth(null, provider, {});

  await auditService.record(req, {
    action: 'assistant.provider_config_updated',
    targetType: 'assistant_provider_config',
    targetId: saved.id,
    metadata: { provider: saved.provider, apiKeyChanged: apiKey !== undefined, apiKeyCloudChanged: apiKeyCloud !== undefined },
  });
  // Baris hasil pembersihan health, bukan `saved` yang dibaca sebelum pembersihan itu -- kalau
  // tidak, responsnya masih membawa health lama yang barusan sengaja dihapus.
  res.json(toProviderConfigDto(cleared));
});

// CR-049. Test Connection satu provider: memakai endpoint list-model provider (lihat
// assistantProviderTest untuk kenapa bukan panggilan chat), lalu menyimpan hasilnya ke baris
// config supaya kartu provider bisa menampilkan "terakhir diperiksa" tanpa memanggil ulang.
//
// Berbagi bucket limiter dengan listProviderModels, bukan bucket sendiri: yang dibatasi adalah
// "berapa kali seorang admin boleh membuat backend menelepon provider AI per menit", dan kedua
// endpoint ini menelepon tujuan yang sama persis.
//
// Selalu 200 selama providernya dikenal -- termasuk saat hasilnya `error`. Kegagalan koneksi
// adalah jawaban yang valid dari sebuah tombol uji, bukan kegagalan permintaannya.
const testProviderConnection = asyncHandler(async (req, res) => {
  assistantModelsRateLimiter.checkBurst(req.user.id);
  const result = await assistantProviderTest.testProvider(req.params.provider);
  await auditService.record(req, {
    action: 'assistant.provider_tested',
    targetType: 'assistant_provider_config',
    targetId: result.config?.id || null,
    metadata: { provider: req.params.provider, status: result.status, latency_ms: result.latency_ms ?? null },
  });
  res.json({ ...result, config: toProviderConfigDto(result.config) });
});

// CR-048. Daftar model yang boleh dipilih untuk satu provider, ditanyakan ke provider-nya sendiri
// (assistantModelCatalog). Selalu `200` walau provider-nya bermasalah: badannya membawa
// `source: 'fallback'` + `warning`, karena dropdown yang kosong dengan halaman error tidak
// memberi tahu admin apa pun yang bisa dia tindak lanjuti.
//
// `?refresh=1` melewati cache 10 menit -- dipakai tombol "Muat ulang" setelah API key dibetulkan.
const listProviderModels = asyncHandler(async (req, res) => {
  assistantModelsRateLimiter.checkBurst(req.user.id);
  const result = await assistantModelCatalog.listModels(req.params.provider, {
    refresh: req.query.refresh === '1' || req.query.refresh === 'true',
  });
  res.json(result);
});

const listPrompts = asyncHandler(async (req, res) => {
  res.json(await assistantConfigRepository.listPrompts({ key: req.query.key, locale: req.query.locale }));
});

const createPrompt = asyncHandler(async (req, res) => {
  const body = promptSchema.parse(req.body);
  const prompt = await assistantConfigRepository.createPromptVersion({
    key: body.key,
    locale: body.locale,
    body: body.body,
    createdBy: req.user.id,
  });
  await auditService.record(req, {
    action: 'assistant.prompt_created',
    targetType: 'assistant_prompt',
    targetId: prompt.id,
    metadata: { key: prompt.key, locale: prompt.locale, version: prompt.version },
  });
  // 201 dengan is_active=false: menulis versi dan menayangkannya adalah dua keputusan berbeda.
  res.status(201).json(prompt);
});

const activatePrompt = asyncHandler(async (req, res) => {
  const prompt = await assistantConfigRepository.activatePromptVersion(req.params.id);
  if (!prompt) throw new ApiError(404, 'not_found', 'Prompt version not found');

  await auditService.record(req, {
    action: 'assistant.prompt_activated',
    targetType: 'assistant_prompt',
    targetId: prompt.id,
    metadata: { key: prompt.key, locale: prompt.locale, version: prompt.version },
  });
  // Tidak ada cache prompt untuk di-invalidasi -- promptBuilder sengaja membaca DB tiap pesan,
  // supaya rollback berlaku pada pesan berikutnya, bukan setelah TTL habis.
  res.json(prompt);
});

// Menggabungkan registry di KODE dengan override di DB, bukan hanya membaca tabel: tool yang
// belum punya baris override tetap harus terlihat oleh admin, kalau tidak tool baru hasil deploy
// jadi tidak kasat mata sampai seseorang menebak namanya.
const listTools = asyncHandler(async (req, res) => {
  const odooConnectionId = req.query.odoo_connection_id || null;
  const overrides = await assistantConfigRepository.listToolOverrides(odooConnectionId);
  const byName = new Map(overrides.map((o) => [o.tool_name, o]));

  res.json(
    toolRegistry.REGISTRY.map((tool) => {
      const override = byName.get(tool.name);
      return {
        tool_name: tool.name,
        kind: tool.kind,
        default_permission: tool.permission,
        default_description: tool.description,
        permission_code: override?.permission_code || tool.permission,
        description_override: override?.description_override || null,
        enabled: override ? override.enabled : true,
        has_override: Boolean(override),
      };
    })
  );
});

const saveTool = asyncHandler(async (req, res) => {
  const body = toolOverrideSchema.parse(req.body);

  // Nama tool divalidasi terhadap registry: baris untuk tool yang tidak ada tidak pernah terbaca,
  // jadi ia hanya akan tampak seperti pengaturan yang tersimpan tapi tidak berpengaruh.
  if (!toolRegistry.REGISTRY.some((t) => t.name === body.tool_name)) {
    throw new ApiError(400, 'unknown_tool', `Unknown tool: ${body.tool_name}`);
  }

  const saved = await assistantConfigRepository.upsertToolOverride(body.odoo_connection_id || null, {
    toolName: body.tool_name,
    permissionCode: body.permission_code,
    descriptionOverride: body.description_override,
    enabled: body.enabled,
  });
  await auditService.record(req, {
    action: 'assistant.tool_updated',
    targetType: 'assistant_tool',
    targetId: saved.id,
    metadata: { toolName: saved.tool_name, enabled: saved.enabled },
  });
  res.json(saved);
});

module.exports = {
  listSettings, saveSettings,
  listProviderConfigs, saveProviderConfig, listProviderModels, testProviderConnection,
  listPrompts, createPrompt, activatePrompt,
  listTools, saveTool,
};

// Menyelesaikan rantai presedensi section 6.2:
//
//   assistant_settings (odoo_connection_id = aktif)
//     -> assistant_settings (global, odoo_connection_id IS NULL)
//       -> env.assistant
//         -> ApiError(503, 'assistant_not_configured')
//
// Aturan yang menyertainya: TIDAK ADA literal sebagai fallback terakhir di dalam JS. Setiap nilai
// wajib harus datang dari salah satu lapis yang punya nama dan tempat -- kalau tidak ada, fitur
// mati dengan error yang menyebut sebabnya, bukan diam-diam jalan dengan angka karangan file ini.
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const crypto = require('../utils/crypto');
const assistantConfigRepository = require('../repositories/assistantConfigRepository');

const CACHE_TTL_MS = 60_000;

// Di-key per odoo_connection_id (string 'global' untuk lapis global) karena presedensinya juga
// per-connection. Cache ini per-proses: kalau backend diskalakan multi-instance, sebuah
// perubahan admin butuh sampai TTL untuk terlihat di instance lain. Redis di luar cakupan spec.
const cache = new Map();

function cacheKey(odooConnectionId) {
  return odooConnectionId || 'global';
}

// Menyimpan baris GLOBAL harus mengosongkan SELURUH cache, bukan satu key saja. Entri cache
// di-key per odoo_connection_id, tapi setiap connection yang tidak punya barisnya sendiri
// menurunkan nilainya dari baris global -- jadi menghapus key 'global' meninggalkan mereka
// memakai nilai lama sampai TTL 60 detik habis. Ini terlihat persis seperti "penyimpanan admin
// tidak berpengaruh", yang tidak bisa dibedakan dari penyimpanan yang gagal.
function invalidate(odooConnectionId) {
  if (!odooConnectionId) cache.clear();
  else cache.delete(cacheKey(odooConnectionId));
}

// Lapis pertama yang memberi nilai bukan-null/undefined yang menang. `false` dan `0` adalah
// nilai sah dan harus lolos -- itulah sebabnya ini bukan rantai `||`.
function pick(...layers) {
  for (const value of layers) {
    if (value !== null && value !== undefined) return value;
  }
  return undefined;
}

function required(value, name) {
  if (value === undefined) {
    throw new ApiError(
      503,
      'assistant_not_configured',
      `Assistant configuration is incomplete: "${name}" is not set in assistant_settings or the environment`
    );
  }
  return value;
}

// API key per-connection disimpan terenkripsi (AES-256-GCM, pola odoo_connections). Kegagalan
// dekripsi berarti ENCRYPTION_KEY berganti setelah baris ditulis -- lebih baik gagal dengan
// sebab yang jelas daripada diam-diam jatuh ke key env milik connection lain.
function decryptApiKey(row) {
  if (!row || !row.encrypted_api_key) return undefined;
  try {
    return crypto.decrypt(row.encrypted_api_key);
  } catch {
    throw new ApiError(
      503,
      'assistant_not_configured',
      'Stored assistant API key cannot be decrypted -- ENCRYPTION_KEY may have changed since it was saved'
    );
  }
}

// Konfigurasi Provider AI (My Account > Setting, 0012_assistant_provider_configs.sql): model,
// API key, dan base URL sekarang punya baris SENDIRI per provider, bukan satu slot bersama di
// assistant_settings. resolve() memilih baris provider_configs milik PROVIDER AKTIF (connection
// -> global) dulu, baru turun ke kolom lama assistant_settings.model/base_url/encrypted_api_key
// sebagai fallback -- itulah yang menjaga instalasi lama (terisi sebelum tabel ini ada) tetap
// jalan tanpa harus diisi ulang.
function decryptProviderApiKey(row, column) {
  if (!row || !row[column]) return undefined;
  try {
    return crypto.decrypt(row[column]);
  } catch {
    throw new ApiError(
      503,
      'assistant_not_configured',
      'Stored assistant provider API key cannot be decrypted -- ENCRYPTION_KEY may have changed since it was saved'
    );
  }
}

// Ollama saja: 'auto' memilih Cloud kalau API Key Cloud terisi, kalau tidak diteruskan ke daemon
// lokal (base_url) -- persis deskripsi field "Target" di halaman Konfigurasi Provider AI.
// 'local'/'cloud' memaksa sisi itu terlepas dari ada-tidaknya key, supaya admin bisa menyiapkan
// Cloud tanpa langsung mengaktifkannya (isi key dulu, baru pindah Target belakangan).
function resolveOllamaProviderFields(row) {
  if (!row) return {};
  const target = row.ollama_target || 'auto';
  const cloudKey = decryptProviderApiKey(row, 'encrypted_api_key_cloud');
  const useCloud = target === 'cloud' || (target === 'auto' && Boolean(cloudKey));
  const model = row.ollama_model_manual || row.model;
  if (useCloud) {
    return { model, baseUrl: row.base_url_cloud || 'https://ollama.com', apiKey: cloudKey };
  }
  return { model, baseUrl: row.base_url, apiKey: undefined };
}

// Provider config non-Ollama (claude/gemini): tidak ada mode target, langsung model/apiKey/baseUrl
// dari baris yang berlaku (baris pertama yang bukan null/undefined -- pick() semantics).
function providerFields(provider, connectionRow, globalRow) {
  if (provider === 'ollama') {
    const fromConnection = resolveOllamaProviderFields(connectionRow);
    const fromGlobal = resolveOllamaProviderFields(globalRow);
    return {
      model: pick(fromConnection.model, fromGlobal.model),
      baseUrl: pick(fromConnection.baseUrl, fromGlobal.baseUrl),
      apiKey: pick(fromConnection.apiKey, fromGlobal.apiKey),
    };
  }
  return {
    model: pick(connectionRow?.model, globalRow?.model),
    baseUrl: pick(connectionRow?.base_url, globalRow?.base_url),
    apiKey: pick(
      decryptProviderApiKey(connectionRow, 'encrypted_api_key'),
      decryptProviderApiKey(globalRow, 'encrypted_api_key')
    ),
  };
}

async function resolve(odooConnectionId) {
  const key = cacheKey(odooConnectionId);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const { connection, global } = await assistantConfigRepository.findSettings(odooConnectionId || null);

  const enabled = pick(connection?.enabled, global?.enabled, env.assistant.enabled);
  if (!enabled) {
    throw new ApiError(503, 'assistant_not_configured', 'The assistant is not enabled');
  }

  const provider = required(pick(connection?.provider, global?.provider, env.assistant.provider), 'provider');
  const { connection: pcConnection, global: pcGlobal } = await assistantConfigRepository.findProviderConfig(
    odooConnectionId || null,
    provider
  );
  const pf = providerFields(provider, pcConnection, pcGlobal);

  const config = {
    enabled: true,
    provider,
    model: required(pick(pf.model, connection?.model, global?.model, env.assistant.model), 'model'),
    baseUrl: pick(pf.baseUrl, connection?.base_url, global?.base_url, env.assistant.baseUrl),
    apiKey: pick(pf.apiKey, decryptApiKey(connection), decryptApiKey(global), env.assistant.apiKey),
    // Numeric di pg datang sebagai string (pg tidak mengasumsikan presisi float aman) -- Number()
    // di sini, bukan di pemanggil, supaya provider adapter selalu menerima angka.
    temperature: Number(required(pick(connection?.temperature, global?.temperature, env.assistant.temperature), 'temperature')),
    maxOutputTokens: Number(required(pick(connection?.max_output_tokens, global?.max_output_tokens, env.assistant.maxOutputTokens), 'max_output_tokens')),
    maxToolIterations: Number(required(pick(connection?.max_tool_iterations, global?.max_tool_iterations, env.assistant.maxToolIterations), 'max_tool_iterations')),
    historyWindow: Number(required(pick(connection?.history_window, global?.history_window, env.assistant.historyWindow), 'history_window')),
    dailyMessageQuota: Number(required(pick(connection?.daily_message_quota, global?.daily_message_quota, env.assistant.dailyMessageQuota), 'daily_message_quota')),
    burstPerMinute: Number(required(pick(connection?.burst_per_minute, global?.burst_per_minute, env.assistant.burstPerMinute), 'burst_per_minute')),
    defaultLocale: required(pick(connection?.default_locale, global?.default_locale, env.assistant.defaultLocale), 'default_locale'),
    // Timeout sengaja hanya dari env: ini batas kesehatan proses Node, bukan pilihan produk yang
    // masuk akal diserahkan ke admin per-company.
    timeoutMs: env.assistant.timeoutMs,
  };

  cache.set(key, { value: config, expiresAt: Date.now() + CACHE_TTL_MS });
  return config;
}

// Bentuk aman untuk klien (section 6.3): frontend tidak boleh tahu provider, model, atau prompt.
// Dipanggil lewat GET /assistant/config, dan sengaja tidak melempar saat asisten mati -- widget
// perlu tahu "mati" untuk masuk mode degradasi, bukan menerima 503 dan menampilkan error.
async function getClientConfig(odooConnectionId, promptBuilder) {
  let config;
  try {
    config = await resolve(odooConnectionId);
  } catch (err) {
    if (err.code === 'assistant_not_configured') return { enabled: false, locales: [], default_locale: null, starters: [] };
    throw err;
  }
  const starters = await promptBuilder.getStarters(config.defaultLocale);
  return {
    enabled: true,
    locales: ['id', 'en'],
    default_locale: config.defaultLocale,
    starters,
  };
}

module.exports = { resolve, getClientConfig, invalidate, CACHE_TTL_MS };

const assistantConfigRepository = require('../repositories/assistantConfigRepository');
const assistantModelCatalog = require('./assistantModelCatalog');
const ApiError = require('../utils/ApiError');

// CR-049. "Test Connection" untuk satu provider AI, dan penyimpanan hasilnya (health_* di
// assistant_provider_configs, migrasi 0016).
//
// Ujinya memakai endpoint list-model provider, BUKAN satu panggilan chat percobaan. Dua alasan,
// dan yang kedua yang menentukan:
//
//   1. Panggilan chat menghabiskan token setiap kali tombol ditekan -- pada tombol yang justru
//      ada untuk ditekan berulang kali saat admin sedang membetulkan konfigurasi.
//   2. List-model menjawab lebih banyak: ia membuktikan server terjangkau DAN kredensialnya
//      diterima DAN model yang dikonfigurasi benar-benar ada di sana. Panggilan chat yang sukses
//      hanya membuktikan model yang dipakai saat itu bekerja; ia tidak bisa membedakan "model
//      salah ketik" dari "kunci salah" ketika gagal.
//
// Karena itu hasilnya tiga, bukan dua. `degraded` adalah keadaan yang paling sering terjadi tapi
// paling jarang punya nama: semuanya benar kecuali model yang dipilih tidak ada di daftar provider
// -- dan itu kegagalan yang, tanpa status sendiri, hanya bisa dilaporkan sebagai kebohongan ke
// salah satu arah (lihat komentar migrasi 0016).

// Ollama lokal tidak butuh kredensial apa pun, jadi ia bisa diuji sejak sebelum ada baris config.
const REQUIRES_API_KEY = { claude: true, gemini: true, ollama: false };

function configuredModel(row) {
  if (!row) return null;
  // Presedensi yang sama persis dengan assistantConfigService.resolveOllamaProviderFields --
  // menguji model yang berbeda dari yang benar-benar dipakai runtime adalah uji yang menyesatkan.
  return row.ollama_model_manual || row.model || null;
}

async function testProvider(provider) {
  if (!Object.prototype.hasOwnProperty.call(REQUIRES_API_KEY, provider)) {
    throw new ApiError(404, 'not_found', 'Unknown provider');
  }

  const { global: row } = await assistantConfigRepository.findProviderConfig(null, provider);
  const model = configuredModel(row);

  if (REQUIRES_API_KEY[provider] && !row?.encrypted_api_key) {
    // Health lama dihapus, bukan dibiarkan. Kalau kuncinya baru saja dihapus admin, meninggalkan
    // `connected` dari pemeriksaan minggu lalu berarti kartu provider ini menampilkan hijau untuk
    // konfigurasi yang sudah tidak ada -- bentuk kebohongan yang sama dengan BUG-30.
    const cleared = await assistantConfigRepository.recordProviderHealth(null, provider, {});
    return {
      status: 'not_configured',
      message: 'API key belum diisi, jadi tidak ada yang bisa diuji.',
      model,
      config: cleared,
    };
  }

  const startedAt = Date.now();
  // refresh: true -- menguji koneksi lalu menjawab dari cache 10 menit adalah uji palsu.
  const catalog = await assistantModelCatalog.listModels(provider, { refresh: true });
  const latencyMs = Date.now() - startedAt;

  let status;
  let message;
  if (catalog.source !== 'provider') {
    status = 'error';
    message = catalog.warning || 'Provider tidak bisa dihubungi.';
  } else if (!model) {
    status = 'degraded';
    message = `Terhubung (${catalog.models.length} model tersedia), tapi belum ada model yang dipilih.`;
  } else if (!catalog.models.some((m) => m.id === model)) {
    status = 'degraded';
    message = `Terhubung, tapi model "${model}" tidak ada di ${catalog.models.length} model yang dikembalikan provider.`;
  } else {
    status = 'connected';
    message = `Terhubung. Model "${model}" tersedia (${catalog.models.length} model total).`;
  }

  const config = await assistantConfigRepository.recordProviderHealth(null, provider, {
    health_status: status,
    health_checked_at: new Date(),
    // Pesan sukses ikut disimpan supaya kartu provider bisa menampilkan hasil pemeriksaan terakhir
    // tanpa memanggil ulang. Kolomnya bernama health_error karena itu isi yang dominan, bukan
    // karena isinya selalu kesalahan.
    health_error: message,
    health_latency_ms: latencyMs,
  });

  return { status, message, model, latency_ms: latencyMs, model_count: catalog.models.length, config };
}

module.exports = { testProvider };

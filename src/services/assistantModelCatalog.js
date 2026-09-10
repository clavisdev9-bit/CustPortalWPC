const assistantConfigRepository = require('../repositories/assistantConfigRepository');
const crypto = require('../utils/crypto');
const ApiError = require('../utils/ApiError');

// CR-048. Daftar model yang bisa dipilih admin di "Konfigurasi Provider AI", dibaca dari
// PROVIDER-nya sendiri, bukan dari konstanta di kode ini.
//
// Alasannya konkret, bukan preferensi arsitektur: field model sebelumnya kotak teks bebas, jadi
// salah ketik tersimpan tanpa protes dan baru terlihat saat pengguna memakai asisten -- gagalnya
// di layar pelanggan, bukan di halaman admin.
//
// Katalog statis akan mengulangi masalah yang sama dari sisi lain, dan itu terbukti saat CR ini
// dikerjakan: halaman dokumentasi Google TIDAK memuat `gemini-3.7-flash`, sementara endpoint
// ListModels dengan kunci milik lingkungan ini mengembalikan model itu (dari 40 model yang
// tersedia). Artinya bahkan dokumentasi resmi pun tertinggal dari API-nya, apalagi konstanta di
// repo yang di-deploy sesekali. Jadi sumber kebenarannya adalah endpoint list-model milik
// provider -- dan konstanta di bawah HANYA jaring
// pengaman untuk keadaan di mana panggilan itu tidak mungkin dilakukan (API key belum diisi,
// jaringan mati, daemon Ollama belum jalan). Pola yang sama dengan odooCapabilityService (CR-046):
// tanya sumbernya, cache sebentar, dan jangan pernah menebak.
//
// Nilai yang sedang tersimpan tidak pernah dibuang dari daftar (lihat mergeSelected di frontend):
// admin harus bisa melihat model apa yang sedang dipakai walaupun provider tidak lagi
// mendaftarkannya -- itu justru informasi yang paling ingin dilihat saat asisten mendadak gagal.

const CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;

// Jaring pengaman, bukan katalog. Sengaja pendek dan hanya berisi model teks yang stabil: daftar
// ini ada supaya dropdown tidak pernah kosong, bukan supaya admin memilih dari sini.
// Terakhir disegarkan 2026-09-04 dari https://ai.google.dev/gemini-api/docs/models dan (untuk
// Claude) daftar model Anthropic yang berlaku saat itu. Kalau isinya sudah terasa tua, itu normal
// -- yang perlu diperbaiki bukan konstanta ini, melainkan alasan kenapa panggilan live-nya gagal.
const FALLBACK_MODELS = {
  gemini: [
    { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
    { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' },
    { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
  ],
  claude: [
    { id: 'claude-opus-5', label: 'Claude Opus 5' },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
    { id: 'claude-fable-5', label: 'Claude Fable 5' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  ],
  ollama: [
    { id: 'qwen3:4b', label: 'qwen3:4b' },
    { id: 'qwen3:8b', label: 'qwen3:8b' },
    { id: 'qwen3:14b', label: 'qwen3:14b' },
    { id: 'llama3.1:8b', label: 'llama3.1:8b' },
    { id: 'deepseek-r1:7b', label: 'deepseek-r1:7b' },
  ],
};

const cache = new Map(); // provider -> { at, payload }

// Kunci disimpan terenkripsi (AES-256-GCM). Kegagalan dekripsi hampir selalu berarti
// ENCRYPTION_KEY berubah sejak kunci itu disimpan -- di jalur ini itu bukan alasan untuk
// menggagalkan permintaan: daftar cadangan tetap berguna, dan pesannya ikut dibawa ke UI supaya
// admin tahu kenapa daftarnya tidak live.
function decryptOrNull(value) {
  if (!value) return null;
  try {
    return crypto.decrypt(value);
  } catch {
    return null;
  }
}

async function fetchJson(url, headers) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    // Body-nya sengaja tidak diteruskan mentah-mentah ke UI: respons error provider bisa memuat
    // potongan kunci atau detail akun. Statusnya sudah cukup untuk mengarahkan admin.
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return res.json();
}

// `generateContent` adalah satu-satunya method yang dipakai adapter Gemini di repo ini, jadi model
// embedding/TTS/video ikut tersaring keluar dengan sendirinya -- tidak perlu daftar larangan yang
// harus dirawat.
async function fetchGemini(row) {
  const apiKey = decryptOrNull(row?.encrypted_api_key);
  if (!apiKey) return { models: null, warning: 'API key Gemini belum diisi, jadi daftar model tidak bisa ditanyakan ke Google.' };
  const data = await fetchJson('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
    // Header, bukan query string `?key=` -- alasan yang sama dengan komentar di
    // providers/gemini.js: query string ikut tercatat di access log proxy/CDN mana pun.
    'x-goog-api-key': apiKey,
  });
  const models = (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => ({
      id: String(m.name || '').replace(/^models\//, ''),
      label: m.displayName || String(m.name || '').replace(/^models\//, ''),
      note: m.inputTokenLimit ? `${Math.round(m.inputTokenLimit / 1000)}K konteks` : null,
    }))
    .filter((m) => m.id);
  return { models, warning: null };
}

async function fetchClaude(row) {
  const apiKey = decryptOrNull(row?.encrypted_api_key);
  if (!apiKey) return { models: null, warning: 'API key Anthropic belum diisi, jadi daftar model tidak bisa ditanyakan ke Anthropic.' };
  const data = await fetchJson('https://api.anthropic.com/v1/models?limit=100', {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  });
  const models = (data.data || []).map((m) => ({ id: m.id, label: m.display_name || m.id, note: null }));
  return { models, warning: null };
}

// Ollama tidak punya katalog global: yang bisa dijawab daemon adalah model yang BENAR-BENAR sudah
// di-pull di mesin itu. Justru itu jawaban yang paling berguna -- daftar hardcode sebelumnya
// menawarkan model yang belum tentu ada, dan kegagalannya baru muncul saat pengguna mengirim
// pesan pertama.
async function fetchOllama(row) {
  const cloudKey = decryptOrNull(row?.encrypted_api_key_cloud);
  const useCloud = row?.ollama_target === 'cloud' || (row?.ollama_target !== 'local' && cloudKey);
  const baseUrl = (useCloud ? row?.base_url_cloud || 'https://ollama.com' : row?.base_url || 'http://localhost:11434')
    .replace(/\/+$/, '');
  const headers = useCloud && cloudKey ? { Authorization: `Bearer ${cloudKey}` } : {};
  const data = await fetchJson(`${baseUrl}/api/tags`, headers);
  const models = (data.models || []).map((m) => ({
    id: m.name,
    label: m.name,
    note: m.details?.parameter_size || null,
  }));
  return { models, warning: models.length ? null : `Tidak ada model yang sudah di-pull di ${baseUrl}.` };
}

const FETCHERS = { gemini: fetchGemini, claude: fetchClaude, ollama: fetchOllama };

// Selalu mengembalikan daftar yang bisa dipakai -- tidak pernah melempar karena provider-nya
// bermasalah. Kegagalan diturunkan menjadi `source: 'fallback'` + `warning` yang ditampilkan apa
// adanya di UI, karena "kenapa daftarnya pendek/tua" adalah pertanyaan pertama admin, dan
// menjawabnya dengan halaman error hanya memaksa dia menebak.
async function listModels(provider, { refresh = false } = {}) {
  if (!FETCHERS[provider]) throw new ApiError(404, 'not_found', 'Unknown provider');

  const cached = cache.get(provider);
  if (!refresh && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.payload;

  const { global: row } = await assistantConfigRepository.findProviderConfig(null, provider);

  let payload;
  try {
    const { models, warning } = await FETCHERS[provider](row);
    payload = models
      ? { provider, source: 'provider', models, warning, fetched_at: new Date().toISOString() }
      : { provider, source: 'fallback', models: FALLBACK_MODELS[provider], warning, fetched_at: new Date().toISOString() };
  } catch (err) {
    payload = {
      provider,
      source: 'fallback',
      models: FALLBACK_MODELS[provider],
      warning: `Gagal menghubungi ${provider}: ${err.message}. Daftar cadangan ditampilkan dan bisa saja sudah tertinggal.`,
      fetched_at: new Date().toISOString(),
    };
  }

  // Hasil fallback ikut di-cache: kalau provider-nya sedang mati, mengulang panggilan yang sama
  // setiap kali halaman dibuka hanya menambah 8 detik timeout ke setiap pemuatan. Tombol "Muat
  // ulang" di UI mengirim refresh=1 dan melewati cache ini.
  cache.set(provider, { at: Date.now(), payload });
  return payload;
}

// Dipanggil setelah config provider disimpan: kunci/base URL yang baru berarti jawaban yang
// berbeda, dan menunggu 10 menit untuk melihatnya adalah persis kebingungan yang CR ini hilangkan.
function invalidate(provider) {
  if (provider) cache.delete(provider);
  else cache.clear();
}

module.exports = { listModels, invalidate, FALLBACK_MODELS };

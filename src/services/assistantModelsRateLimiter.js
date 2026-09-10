// CLAUDE.md "Keterbatasan yang diketahui": belum ada rate limiting umum, jadi endpoint baru yang
// mahal wajib membawa pembatasnya sendiri.
//
// Yang mahal di `GET /admin/assistant/provider-configs/:provider/models` bukan CPU portal,
// melainkan panggilan keluarnya -- dan untuk Ollama alamat tujuannya diambil dari `base_url` yang
// diisi admin sendiri. Itu bentuk yang sama persis dengan `check-connection` di CR-044: sebuah
// endpoint yang membuat backend menelepon alamat pilihan pemanggil. Cache 10 menit di
// assistantModelCatalog sudah menahan jalur normal, tapi tombol "Muat ulang" mengirim `refresh=1`
// yang sengaja melewati cache itu -- jadi tanpa pembatas ini, batas atasnya adalah kecepatan
// seseorang menekan tombol.
//
// Ini salinan ketiga dari pola burst in-memory yang sama (assistant/rateLimiter.js checkBurst,
// equipmentRateLimiter.js, odooConnectionRateLimiter.js). Disalin, bukan digeneralisasi, karena
// keempatnya berbeda pada hal yang justru terlihat pengguna -- pesan, batas, dan apakah ada kuota
// harian/circuit breaker di atasnya. Menyatukannya adalah refactor tersendiri yang tidak pantas
// menumpang di CR yang sedang memperbaiki dropdown model.
const ApiError = require('../utils/ApiError');

const WINDOW_MS = 60_000;
// Membuka halaman = 3 provider = 3 panggilan (semuanya kena cache setelah yang pertama). Sisanya
// untuk "Muat ulang" yang ditekan berkali-kali saat admin sedang membetulkan API key.
const MAX_PER_WINDOW = 20;

const buckets = new Map(); // portalUserId -> { windowStart, count }

function checkBurst(portalUserId) {
  const now = Date.now();
  const bucket = buckets.get(portalUserId);

  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    buckets.set(portalUserId, { windowStart: now, count: 1 });
    return;
  }
  if (bucket.count >= MAX_PER_WINDOW) {
    const retryAfter = Math.ceil((bucket.windowStart + WINDOW_MS - now) / 1000);
    throw new ApiError(429, 'rate_limited', `Terlalu sering memuat daftar model. Coba lagi dalam ${retryAfter} detik.`);
  }
  bucket.count += 1;
}

// Sama seperti tiga pembatas lainnya: sapu bucket lama supaya Map-nya tidak tumbuh sebesar jumlah
// admin yang pernah memanggil endpoint ini selama umur proses.
const sweeper = setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [key, bucket] of buckets) {
    if (bucket.windowStart < cutoff) buckets.delete(key);
  }
}, WINDOW_MS);
sweeper.unref?.();

module.exports = { checkBurst };

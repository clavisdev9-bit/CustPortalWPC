// CLAUDE.md "Keterbatasan yang diketahui": portal ini belum punya rate limiting umum
// (system.md §17), jadi endpoint baru yang mahal wajib membawa pembatasnya sendiri.
//
// Yang mahal di sini bukan CPU portal, tapi panggilan keluar: sejak CR-044 tiga endpoint config
// (`check-connection`, `POST /`, `PATCH /:id`) benar-benar menghubungi Odoo -- dan
// `check-connection` menerima URL sembarang tanpa menyimpan apa pun, jadi tanpa pembatas ia
// adalah alat pemindai jaringan yang rapi bagi siapa pun yang sudah menjadi platform admin.
// Satu bucket dipakai bersama oleh ketiganya: yang dibatasi adalah "berapa kali seorang admin
// boleh membuat backend ini menelepon Odoo per menit", bukan endpoint-nya satu per satu.
//
// Pola burst in-memory ini ditiru dari src/services/equipmentRateLimiter.js (yang sendiri meniru
// src/services/assistant/rateLimiter.js checkBurst) -- tanpa kuota harian atau circuit breaker,
// karena keduanya menjawab biaya panggilan LLM yang tidak berlaku di sini. Sama seperti keduanya:
// bucket-nya hidup di memori proses, jadi kalau backend diskalakan multi-instance, batasnya jadi
// per-instance dan tidak akurat lintas instance.
const ApiError = require('../utils/ApiError');

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 12; // satu percobaan wizard = ~2 panggilan (check + save); sisanya untuk retry

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
    throw new ApiError(429, 'rate_limited', `Too many Odoo connection attempts. Try again in ${retryAfter}s.`);
  }
  bucket.count += 1;
}

// Sama seperti dua pembatas lainnya: sapu bucket yang sudah lama tidak dipakai supaya Map-nya
// tidak tumbuh sebesar jumlah admin yang pernah memanggil endpoint ini selama umur proses.
const sweeper = setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [userId, bucket] of buckets) {
    if (bucket.windowStart < cutoff) buckets.delete(userId);
  }
}, WINDOW_MS);
if (typeof sweeper.unref === 'function') sweeper.unref();

module.exports = { checkBurst };

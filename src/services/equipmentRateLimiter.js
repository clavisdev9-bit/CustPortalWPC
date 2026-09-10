// §15.2: portal ini belum punya rate limiting umum (system.md §17); GET /equipment/due-replacements
// adalah endpoint termahal fitur ini (§15.1) dan wajib membawa pembatasnya sendiri. Pola burst
// in-memory ini sengaja ditiru dari src/services/assistant/rateLimiter.js checkBurst -- tanpa
// kuota harian atau circuit breaker, karena keduanya menjawab biaya panggilan LLM yang tidak
// berlaku di sini.
//
// Sama seperti pembatas asisten: bucket-nya hidup di memori proses, jadi kalau backend
// diskalakan multi-instance, batasnya jadi per-instance dan tidak akurat lintas instance
// (CLAUDE.md "Keterbatasan yang diketahui").
const ApiError = require('../utils/ApiError');

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;

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
    throw new ApiError(429, 'rate_limited', `Too many requests. Try again in ${retryAfter}s.`);
  }
  bucket.count += 1;
}

// Sama seperti assistant rateLimiter: sapu bucket yang sudah lama tidak dipakai supaya Map-nya
// tidak tumbuh sebesar jumlah user yang pernah memanggil endpoint ini selama umur proses.
const sweeper = setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [userId, bucket] of buckets) {
    if (bucket.windowStart < cutoff) buckets.delete(userId);
  }
}, WINDOW_MS);
if (typeof sweeper.unref === 'function') sweeper.unref();

module.exports = { checkBurst };

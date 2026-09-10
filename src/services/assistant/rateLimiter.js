// Tiga pembatas untuk endpoint chat (section 10.4). Portal ini BELUM punya rate limiting sama
// sekali (system.md §17), jadi endpoint mahal wajib membawa pembatasnya sendiri -- dan chat
// adalah endpoint termahal di portal: satu pesan bisa memicu beberapa panggilan LLM plus
// beberapa round-trip XML-RPC ke Odoo.
const ApiError = require('../../utils/ApiError');
const assistantRepository = require('../../repositories/assistantRepository');

// Burst dan circuit breaker hidup di memori proses. Kalau backend diskalakan multi-instance,
// keduanya jadi per-instance: kuota burst efektif terkali jumlah instance, dan satu instance
// bisa menutup sirkuit sementara yang lain masih mencoba. Redis di luar cakupan spec ini --
// dicatat di sini supaya keterbatasannya tidak ditemukan saat insiden.
const burstBuckets = new Map(); // portalUserId -> { windowStart, count }
const BURST_WINDOW_MS = 60_000;

const breaker = { consecutiveFailures: 0, openedAt: null };
const BREAKER_THRESHOLD = 5;
const BREAKER_COOLDOWN_MS = 60_000;

// Kuota harian: dihitung dari baris assistant_messages, bukan dari counter di memori, supaya
// restart proses tidak mengembalikan kuota seseorang -- itu akan membuat batasnya bisa
// dilewati siapa pun yang tahu kapan deploy terjadi.
async function checkDailyQuota(portalUserId, odooConnectionId, config) {
  const used = await assistantRepository.countUserMessagesToday(portalUserId, odooConnectionId);
  if (used >= config.dailyMessageQuota) {
    throw new ApiError(
      429,
      'rate_limited',
      `Daily assistant message limit reached (${config.dailyMessageQuota}). It resets at midnight.`
    );
  }
}

function checkBurst(portalUserId, config) {
  const now = Date.now();
  const bucket = burstBuckets.get(portalUserId);

  if (!bucket || now - bucket.windowStart >= BURST_WINDOW_MS) {
    burstBuckets.set(portalUserId, { windowStart: now, count: 1 });
    return;
  }
  if (bucket.count >= config.burstPerMinute) {
    const retryAfter = Math.ceil((bucket.windowStart + BURST_WINDOW_MS - now) / 1000);
    throw new ApiError(429, 'rate_limited', `Too many messages in a row. Try again in ${retryAfter}s.`);
  }
  bucket.count += 1;
}

// Dipanggil sebelum menyentuh provider. Sirkuit terbuka = provider dianggap mati, dan setiap
// permintaan ditolak cepat dengan 503 supaya widget masuk mode degradasi alih-alih membuat
// setiap pengguna menunggu satu timeout penuh masing-masing.
function checkBreaker() {
  if (breaker.openedAt === null) return;
  if (Date.now() - breaker.openedAt >= BREAKER_COOLDOWN_MS) {
    // Setengah terbuka: satu permintaan berikutnya dibiarkan lewat sebagai penjajakan.
    // Kalau berhasil, recordSuccess menutup sirkuit; kalau gagal, recordFailure membukanya lagi.
    breaker.openedAt = null;
    breaker.consecutiveFailures = BREAKER_THRESHOLD - 1;
    return;
  }
  throw new ApiError(503, 'assistant_unavailable', 'The assistant is temporarily unavailable. Please try again shortly.');
}

function recordSuccess() {
  breaker.consecutiveFailures = 0;
  breaker.openedAt = null;
}

function recordFailure() {
  breaker.consecutiveFailures += 1;
  if (breaker.consecutiveFailures >= BREAKER_THRESHOLD && breaker.openedAt === null) {
    breaker.openedAt = Date.now();
    console.error(`assistant circuit breaker opened after ${BREAKER_THRESHOLD} consecutive provider failures`);
  }
}

// Bucket burst milik user yang sudah lama tidak mengirim apa pun tidak pernah dibaca lagi;
// tanpa penyapuan ini Map-nya tumbuh sebesar jumlah user yang pernah memakai asisten selama
// umur proses. Interval di-unref supaya tidak menahan proses tetap hidup saat shutdown.
const sweeper = setInterval(() => {
  const cutoff = Date.now() - BURST_WINDOW_MS;
  for (const [userId, bucket] of burstBuckets) {
    if (bucket.windowStart < cutoff) burstBuckets.delete(userId);
  }
}, BURST_WINDOW_MS);
if (typeof sweeper.unref === 'function') sweeper.unref();

module.exports = {
  checkDailyQuota,
  checkBurst,
  checkBreaker,
  recordSuccess,
  recordFailure,
  BREAKER_THRESHOLD,
  BREAKER_COOLDOWN_MS,
};

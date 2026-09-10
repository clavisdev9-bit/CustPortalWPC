// Pembaca baris untuk respons streaming provider. Ketiga provider memakai protokol berbasis
// baris tapi berbeda bungkusnya: Ollama mengirim NDJSON (satu objek JSON per baris), Anthropic
// dan Gemini mengirim SSE (`event:` + `data:`). Yang sama di antara ketiganya cuma satu hal --
// potongan yang tiba dari jaringan TIDAK sejajar dengan batas baris. Satu baris JSON bisa
// terbelah dua chunk, dan satu chunk bisa memuat lima baris. Buffering itu yang dikerjakan
// di sini, sekali, supaya tidak salah diulang tiga kali.
const ApiError = require('../../../utils/ApiError');

// Body fetch() di Node 18+ adalah web ReadableStream, bukan stream Node -- ia punya
// getReader(), bukan event 'data'.
async function* iterateLines(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch (err) {
        // Timeout yang jatuh DI TENGAH stream, bukan saat fetch: header sudah tiba, jadi
        // AbortController membatalkan pembacaan, bukan permintaannya. Tanpa terjemahan ini
        // DOMException mentahnya lolos ke errorHandler dan muncul sebagai 500 internal_error --
        // padahal penyebabnya sama persis dengan timeout sebelum header, yang jadi 503.
        // Bedanya penting: widget masuk mode degradasi pada 503, tidak pada 500.
        if (err.name === 'AbortError') {
          throw new ApiError(503, 'assistant_timeout', 'The assistant provider did not respond in time');
        }
        throw err;
      }
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });

      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
        buffer = buffer.slice(newlineIndex + 1);
        if (line) yield line;
        newlineIndex = buffer.indexOf('\n');
      }
    }
    // Baris terakhir tanpa newline penutup -- Ollama melakukan ini saat koneksi ditutup tepat
    // setelah objek terakhir.
    const tail = buffer.trim();
    if (tail) yield tail;
  } finally {
    // Melepas reader membatalkan permintaan HTTP-nya. Wajib dijalankan juga saat konsumen
    // berhenti lebih awal (pengguna menekan Stop, atau loop tool melempar), kalau tidak
    // koneksi ke provider menggantung sampai timeout-nya sendiri.
    reader.cancel().catch(() => {});
  }
}

// Hanya baris `data:` yang membawa payload di SSE; `event:`, `id:`, dan komentar `:` diabaikan.
// Nama event tidak dipakai di sini karena Anthropic maupun Gemini sudah menaruh diskriminator
// tipenya di dalam JSON payload-nya sendiri.
async function* iterateSseData(response) {
  for await (const line of iterateLines(response)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    yield data;
  }
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    // Satu baris rusak tidak boleh menjatuhkan seluruh jawaban yang sudah separuh terkirim.
    return null;
  }
}

// Pemetaan status HTTP -> ApiError yang sama untuk ketiga provider. Tiga kelas dibedakan karena
// tiga-tiganya menuntut perlakuan berbeda dari pemanggil:
//
//   429 rate_limited    -- provider sehat, hanya membatasi kita. TIDAK menghitung maju circuit
//                          breaker: membukanya karena ini akan mematikan asisten justru saat ia
//                          paling banyak dipakai.
//   503/529 overloaded  -- provider hidup tapi sedang kelebihan beban ("high demand", UNAVAILABLE
//                          di Gemini, "overloaded_error" 529 di Anthropic). Sifatnya sementara dan
//                          layak dicoba lagi, jadi pengguna diberi tombol Ulangi, bukan langsung
//                          didorong ke mode degradasi. Kalau ternyata berulang, circuit breaker
//                          yang akan membukanya menjadi assistant_unavailable -- itulah sinyal
//                          "benar-benar mati", bukan satu kegagalan tunggal.
//   sisanya             -- provider rusak atau salah konfigurasi.
//
// Body respons provider TIDAK ikut ke dalam message: message ini berakhir di gelembung chat
// pelanggan, dan isi body provider adalah detail internal (nama model, kuota proyek, jejak
// kesalahan) yang tidak berarti apa-apa baginya. Detailnya dicetak ke log server, tempatnya.
const OVERLOADED_STATUSES = new Set([502, 503, 529]);

async function assertOk(res, providerName) {
  if (res.ok) return;
  const text = await res.text().catch(() => '');
  console.error(`${providerName} returned ${res.status}: ${text.slice(0, 500)}`);

  if (res.status === 429) {
    throw new ApiError(429, 'assistant_rate_limited', `${providerName} is rate-limiting requests right now. Please try again shortly.`);
  }
  if (OVERLOADED_STATUSES.has(res.status)) {
    throw new ApiError(503, 'assistant_overloaded', 'The assistant model is busy right now. Please try again in a moment.');
  }
  throw new ApiError(502, 'assistant_provider_error', `The assistant provider returned an unexpected error (HTTP ${res.status}).`);
}

// AbortController per permintaan, dengan timeout yang dibersihkan di finally. Dipakai kedua
// jalur (chat dan chatStream) supaya perilaku timeout-nya identik.
function withTimeout(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

function unreachable(err, providerName) {
  if (err.name === 'AbortError') {
    return new ApiError(503, 'assistant_timeout', 'The assistant provider did not respond in time');
  }
  return new ApiError(503, 'assistant_unreachable', `Cannot reach ${providerName}`);
}

module.exports = { iterateLines, iterateSseData, parseJsonLine, assertOk, withTimeout, unreachable };

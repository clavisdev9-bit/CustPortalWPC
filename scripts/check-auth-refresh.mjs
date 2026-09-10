// Verifikasi jalur sesi di frontend/src/api/client.js: refresh proaktif (CR-051), jaring pengaman
// 401-lalu-ulangi, dan pemulihan lintas-tab (CR-050/BUG-33).
//
// Kenapa skrip ini ada, dengan sangat spesifik: CR-050 mengirimkan `withRefreshLock(async () => {
// ... })();` -- sisa `()` dari IIFE yang digantikannya. Sintaksnya sah, `npm run build` lolos,
// `/code-review` tidak menangkapnya, dan akibatnya SETIAP refresh melempar TypeError sehingga
// apiFetch memanggil clearSession() -- logout paksa tiap 15 menit. Tidak ada satu pun pemeriksaan
// yang ada saat itu yang bisa menemukannya, karena tidak ada satu pun yang MENJALANKAN kode ini.
// Skrip ini menjalankannya.
//
// Caranya: file aslinya disalin ke berkas sementara dengan satu-satunya ekspresi khas Vite
// (`import.meta.env`) diganti, lalu diimpor sungguhan. Bukan salinan logika yang bisa melenceng --
// yang diuji adalah sumber yang sama yang dipakai browser.
//
// Jalankan: node scripts/check-auth-refresh.mjs   (exit code != 0 kalau ada yang gagal)
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(here, '..', 'frontend', 'src', 'api', 'client.js');
const TEMP = path.join(here, '.client-under-test.mjs');

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures += 1;
}

// Token uji: payload asli (perlu `exp` yang terbaca), tanda tangan karangan. Tidak pernah menyentuh
// backend -- stub fetch di bawah yang menjawab semuanya.
const token = (secondsFromNow) => {
  const payload = Buffer.from(JSON.stringify({ sub: 'u', exp: Math.floor(Date.now() / 1000) + secondsFromNow }))
    .toString('base64url');
  return `HEADER.${payload}.NOT-A-REAL-SIGNATURE`;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const store = new Map();
globalThis.__API_BASE__ = undefined;
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, v),
  removeItem: (k) => store.delete(k),
};

let plan = [];
let calls = [];
const session = (refreshToken = 'r-new', ttl = 900) => ({
  ok: true, status: 200, json: async () => ({ access_token: token(ttl), refresh_token: refreshToken, user: { id: 'u' } }),
});
const unauthorized = (code) => ({ ok: false, status: 401, json: async () => ({ error: { code, message: code } }) });
const plainOk = (body) => ({ ok: true, status: 200, json: async () => body });

globalThis.fetch = async (url, options = {}) => {
  calls.push(String(url));
  const step = plan.shift();
  return typeof step === 'function' ? step(String(url), options) : session();
};

const paths = () => calls.map((c) => c.split('/api/v1')[1] || c);

async function main() {
  const source = await readFile(SOURCE, 'utf8');
  await writeFile(TEMP, source.replaceAll('import.meta.env.VITE_API_BASE_URL', 'globalThis.__API_BASE__'));
  const client = await import(`file://${TEMP.replace(/\\/g, '/')}`);

  // 1. Refresh proaktif: token berumur pendek harus disegarkan oleh timer SEBELUM ada permintaan
  //    yang gagal. Ini inti CR-051 -- tidak boleh ada 401 di jalur normal.
  plan = [() => session('r1', 3)];
  await client.login({ email: 'a@b.c', password: 'x' });
  check('login tidak langsung memicu refresh', calls.length === 1, `${calls.length} panggilan`);
  await sleep(1400); // exp 3 detik, skew 60 detik -> delay ter-clamp ke 1 detik
  check('token disegarkan sendiri sebelum kedaluwarsa, tanpa 401',
    calls.filter((c) => c.includes('/auth/refresh')).length === 1, paths().join(' -> '));

  // 2. Token yang sudah melewati ambang: permintaan harus didahului refresh, bukan dikirim untuk
  //    gagal. Menutup kasus tab latar yang timernya dicekik dan laptop yang bangun dari tidur.
  plan = [() => session('r2', 10)];
  await client.refreshSession();
  calls = [];
  plan = [() => session('r3', 900), () => plainOk({ data: [] })];
  await client.apiFetch('/notifications?page_size=10');
  check('token hampir mati: refresh dulu, baru permintaannya',
    calls.length === 2 && calls[0].includes('/auth/refresh') && calls[1].includes('/notifications'),
    paths().join(' -> '));

  // 3. Token segar: jangan ada rotasi tambahan. Tanpa penjaga ini, setiap permintaan akan memicu
  //    refresh dan justru membanjiri backend dengan rotasi.
  calls = [];
  plan = [() => plainOk({ data: [] })];
  await client.apiFetch('/notifications?page_size=10');
  check('token segar: kirim langsung, tanpa refresh tambahan',
    calls.length === 1 && calls[0].includes('/notifications'), paths().join(' -> '));

  // 4. Jaring pengaman tetap ada: 401 tak terduga (backend restart, jam meleset) dipulihkan.
  calls = [];
  plan = [() => unauthorized('unauthenticated'), () => session('r4', 900), () => plainOk({ data: [] })];
  const result = await client.apiFetch('/notifications?page_size=10');
  check('401 tak terduga dipulihkan lewat refresh lalu ulangi',
    result !== null && calls.length === 3 && calls[1].includes('/auth/refresh'), paths().join(' -> '));
  check('sesi tetap hidup sesudah 401 yang berhasil dipulihkan',
    client.getAuthState().status === 'authenticated', client.getAuthState().status);

  // 5. Lintas tab (BUG-33): token kita sudah dirotasi tab lain, dan tab itu sudah menyimpan
  //    penggantinya. Harus dicoba ulang dengan nilai baru, bukan melempar pengguna ke /login.
  calls = [];
  plan = [
    (url, options) => {
      const sent = JSON.parse(options.body).refresh_token;
      store.set('custportal.refreshToken', 'r-dari-tab-lain'); // tab lain menyimpan penggantinya
      return sent === 'r-dari-tab-lain' ? session('r5') : unauthorized('invalid_refresh_token');
    },
    (url, options) => (JSON.parse(options.body).refresh_token === 'r-dari-tab-lain'
      ? session('r5') : unauthorized('invalid_refresh_token')),
  ];
  await client.refreshSession();
  check('token yang sudah dirotasi tab lain: coba ulang dengan token baru, bukan logout',
    calls.length === 2 && client.getAuthState().status === 'authenticated',
    `${calls.length} panggilan, status=${client.getAuthState().status}`);

  // 6. Refresh token yang benar-benar mati: refreshSession melempar, dan apiFetch (bukan
  //    refreshSession) yang mengosongkan sesi. Logout memang jawaban yang benar di sini.
  calls = [];
  plan = [() => unauthorized('invalid_refresh_token')];
  let threw = null;
  await client.refreshSession().catch((err) => { threw = err; });
  check('refresh token mati -> refreshSession melempar invalid_refresh_token',
    threw?.code === 'invalid_refresh_token', threw ? `${threw.code}` : 'tidak melempar');

  calls = [];
  plan = [() => unauthorized('unauthenticated'), () => unauthorized('invalid_refresh_token')];
  await client.apiFetch('/notifications').catch(() => {});
  check('401 + refresh token mati -> sesi dikosongkan (logout)',
    client.getAuthState().status === 'anonymous' && store.get('custportal.refreshToken') === undefined,
    `status=${client.getAuthState().status}`);
}

try {
  await main();
} catch (err) {
  console.error('ERROR', err);
  failures += 1;
} finally {
  await unlink(TEMP).catch(() => {});
}

console.log(failures === 0 ? '\nauth refresh check passed' : `\n${failures} pemeriksaan GAGAL`);
process.exit(failures === 0 ? 0 : 1);

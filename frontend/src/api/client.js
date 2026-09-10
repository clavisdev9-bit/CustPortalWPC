// Relative by default so requests stay same-origin as whatever host served the SPA (localhost,
// a LAN IP, an ngrok tunnel, or a production domain behind the Nginx/Cloudflare reverse proxy) --
// see the proxy in vite.config.js (dev) / reverse proxy topology in system.md section 14 (prod).
// An absolute VITE_API_BASE_URL still works for setups where the API is genuinely on a different
// origin than the SPA.
const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';
const REFRESH_KEY = 'custportal.refreshToken';

let state = { accessToken: null, user: null, status: 'idle' };
const listeners = new Set();

function setState(patch) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener(state));
}

export function getAuthState() {
  return state;
}

export function subscribeAuth(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// fetch() itself only rejects for a network-level failure (DNS, connection refused, offline,
// CORS preflight failure, etc.) -- never for an HTTP error status, which resolves normally and
// is handled by toResult(). The browser's own message for that rejection ("Failed to fetch" /
// "NetworkError when attempting to fetch resource") is indistinguishable from an actual bug in
// this app's routing, which has repeatedly cost real debugging time (see resolution.md BUG-09,
// BUG-10, BUG-11). Rethrow with a message and code that name the actual condition instead.
function networkUnreachableError() {
  const error = new Error('Cannot reach the server. Make sure the backend is running, then try again.');
  error.code = 'network_unreachable';
  return error;
}

// Every real backend error response (see errorHandler.js) is JSON of shape {error:{code,message}},
// with no exception -- ApiError, ZodError, the Postgres-specific branches, and the generic 500
// fallback all return it. So a !res.ok response that doesn't have that shape never actually reached
// the Express app -- e.g. Vite's dev proxy (vite.config.js) answers with its own empty-body,
// text/plain 500 when it can't connect to the backend at all, which fetch() resolves normally
// rather than rejecting. That response skips the rawFetch() catch block where
// networkUnreachableError() lives (see resolution.md BUG-11 / CR-012) and previously fell through
// to the generic "Request failed with status 500" -- indistinguishable from a real app bug.
function isApiErrorPayload(payload) {
  return typeof payload?.error?.message === 'string';
}

async function rawFetch(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && state.accessToken) headers.Authorization = `Bearer ${state.accessToken}`;
  try {
    return await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw networkUnreachableError();
  }
}

async function rawFetchForm(path, formData) {
  const headers = {};
  if (state.accessToken) headers.Authorization = `Bearer ${state.accessToken}`;
  // No Content-Type here -- the browser sets the multipart boundary itself for FormData bodies.
  try {
    return await fetch(`${API_BASE}${path}`, { method: 'POST', headers, body: formData });
  } catch {
    throw networkUnreachableError();
  }
}

async function toResult(res) {
  if (res.status === 204) return null;
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    if (!isApiErrorPayload(payload)) throw networkUnreachableError();
    const error = new Error(payload.error.message);
    error.status = res.status;
    error.code = payload.error.code;
    throw error;
  }
  return payload;
}

// CR-051. Sampai sini, satu-satunya cara SPA ini mengetahui access token-nya sudah kedaluwarsa
// adalah dengan mengirim permintaan yang PASTI gagal, lalu memulihkannya (apiFetch: 401 -> refresh
// -> ulangi). Mekanismenya benar dan tidak pernah merugikan pengguna, tapi ia meninggalkan satu
// `401` di tab Network tiap 15 menit untuk sesi yang sehat-sehat saja -- dan `401` yang normal,
// berulang, serta tidak bisa dibedakan dari yang gawat adalah biaya nyata: dua kali dilaporkan
// sebagai bug (BUG-33), dan setiap kali harus ditelusuri dari nol untuk menyimpulkan "tidak apa-apa".
//
// Jadi kedaluwarsanya dihitung, bukan ditunggu. `exp` dibaca dari access token itu sendiri supaya
// tidak ada angka TTL yang diduplikasi di klien -- kalau ACCESS_TOKEN_TTL di server diubah,
// jadwalnya ikut tanpa satu baris pun berubah di sini.
//
// Ini BUKAN pengganti jalur 401 di apiFetch, dan jalur itu tidak dihapus. Timer bisa telat
// (browser mencekik setTimeout di tab latar), laptop bisa tidur melewati jadwalnya, dan jam klien
// bisa meleset dari jam server. 401-lalu-ulangi tetap menjadi jaring pengaman untuk semua itu;
// yang berubah adalah ia tidak lagi menjadi jalur normal.
const EXPIRY_SKEW_MS = 60_000;

let accessTokenExpiresAt = null;
let proactiveTimer = null;

// Payload JWT dibaca tanpa verifikasi tanda tangan -- dan itu memang aman di sini, karena nilainya
// hanya dipakai untuk MENJADWALKAN refresh milik kita sendiri. Tidak ada keputusan otorisasi yang
// diambil dari isinya; server tetap satu-satunya yang memvalidasi token. base64url perlu
// diterjemahkan sendiri: atob() tidak menerima '-'/'_' dan menuntut padding.
function readExpiry(token) {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const { exp } = JSON.parse(atob(base64));
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    // Token tanpa `exp` yang terbaca berarti kita kembali ke perilaku lama (menunggu 401), bukan
    // gagal. Menjadwalkan dari tebakan justru lebih buruk daripada tidak menjadwalkan.
    return null;
  }
}

function scheduleProactiveRefresh() {
  if (proactiveTimer) clearTimeout(proactiveTimer);
  proactiveTimer = null;
  if (!accessTokenExpiresAt) return;

  // Minimal 1 detik: token yang sudah (hampir) kedaluwarsa saat disimpan tetap dijadwalkan, bukan
  // dijalankan seketika di dalam persistSession -- itu akan memanggil refresh dari dalam refresh.
  const delay = Math.max(accessTokenExpiresAt - Date.now() - EXPIRY_SKEW_MS, 1000);
  proactiveTimer = setTimeout(() => {
    // Kegagalan di sini sengaja ditelan: ini tugas latar, dan memaksa logout dari sini akan
    // menendang pengguna yang sedang mengetik hanya karena jaringan sempat putus. Permintaan
    // sungguhan berikutnya tetap melewati jalur 401 yang menangani kegagalan dengan benar.
    refreshSession().catch(() => {});
  }, delay);
}

// Dipanggil sebelum setiap permintaan ber-auth. Menutup celah yang tidak bisa ditutup timer:
// tab latar yang timernya dicekik, dan laptop yang bangun dari tidur melewati jadwalnya. Di
// kedua keadaan itu token sudah telanjur mati, dan tanpa pemeriksaan ini permintaan pertama
// sesudah bangun tetap menghasilkan 401 yang justru ingin dihilangkan.
export async function ensureFreshAccessToken() {
  if (!state.accessToken || !accessTokenExpiresAt) return;
  if (Date.now() < accessTokenExpiresAt - EXPIRY_SKEW_MS) return;
  // Gagal -> biarkan permintaannya jalan apa adanya; cabang 401 di apiFetch yang memutuskan
  // apakah sesinya benar-benar habis.
  await refreshSession().catch(() => {});
}

function persistSession({ access_token, refresh_token, user }) {
  localStorage.setItem(REFRESH_KEY, refresh_token);
  accessTokenExpiresAt = readExpiry(access_token);
  setState({ accessToken: access_token, user, status: 'authenticated' });
  scheduleProactiveRefresh();
}

export function clearSession() {
  localStorage.removeItem(REFRESH_KEY);
  if (proactiveTimer) clearTimeout(proactiveTimer);
  proactiveTimer = null;
  accessTokenExpiresAt = null;
  setState({ accessToken: null, user: null, status: 'anonymous' });
}

// Refresh tokens are single-use (the backend rotates and revokes the old one on every call --
// see refreshTokenRepository.rotate()). Without this dedup, every request that happens to hit its
// 401 around the same moment (e.g. the notification poll alongside a page's own fetches) reads the
// same not-yet-rotated token from localStorage and races the others to the server: the first
// refresh wins, and every other concurrent caller gets `invalid_refresh_token` for a session that
// is actually still fine, which calls clearSession() and force-logs the user out. Sharing one
// in-flight promise means only the first caller talks to the server; the rest just await its result.
let refreshPromise = null;

// Diekspor supaya api/assistant.js -- yang memakai fetch() + ReadableStream, bukan apiFetch,
// karena SSE tidak bisa lewat parser JSON -- ikut memakai promise in-flight yang SAMA. Menyalin
// ulang logika refresh di sana akan menghidupkan kembali race yang dijelaskan di atas: dua
// pemanggil membaca refresh token yang belum dirotasi, yang kedua kena invalid_refresh_token,
// dan pengguna terlempar ke /login padahal sesinya baik-baik saja.
async function postRefresh(refreshToken) {
  const res = await rawFetch('/auth/refresh', { method: 'POST', body: { refresh_token: refreshToken }, auth: false });
  return toResult(res);
}

// BUG-33. Web Locks menyerialkan refresh ANTAR TAB pada origin yang sama -- bagian yang tidak bisa
// dilakukan `refreshPromise` di atas, yang hanya state modul dan karenanya hanya berlaku di dalam
// satu tab. Tanpa ini, dua tab yang access token-nya kedaluwarsa berbarengan mengirim refresh token
// yang sama secara bersamaan, dan sejak rotasi dibuat atomik (authService.refresh) yang kalah
// menerima 401 lalu melempar penggunanya ke /login.
//
// Dengan lock, tab kedua menunggu, lalu membaca ulang localStorage DI DALAM lock -- saat itu tab
// pertama sudah menyimpan token barunya, jadi tab kedua merotasi dari token yang benar dan
// keduanya sama-sama berhasil, berurutan.
//
// Fallback-nya sengaja "jalan tanpa lock", bukan gagal: `navigator.locks` tidak ada di beberapa
// konteks non-secure dan browser lama. Di sana cabang penyelamat di dalam refreshSession (deteksi
// token yang berubah) tetap menangani kasus yang paling umum.
function withRefreshLock(run) {
  if (!navigator.locks?.request) return run();
  return navigator.locks.request('custportal.refresh', run);
}

export async function refreshSession() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = withRefreshLock(async () => {
    // Dibaca DI DALAM lock, bukan sebelum mengantre: kalau tab lain baru saja merotasi, nilai yang
    // benar sudah ada di sini saat giliran kita tiba.
    const refreshToken = localStorage.getItem(REFRESH_KEY);
    if (!refreshToken) throw new Error('No refresh token stored');
    try {
      const result = await postRefresh(refreshToken);
      persistSession(result);
      return result;
    } catch (err) {
      // BUG-33. Promise in-flight di atas hanya menyatukan pemanggil di dalam SATU tab -- ia state
      // modul, dan tiap tab punya salinannya sendiri. localStorage justru dibagi: dua tab yang
      // access token-nya kedaluwarsa berbarengan (wajar, keduanya lahir dari sesi yang sama) akan
      // membaca refresh token yang sama dan mengirimnya bersamaan.
      //
      // Sebelum BUG-33 keduanya "berhasil" karena rotasi di backend tidak atomik -- sesi berakhir
      // dengan dua token aktif, dan sifat sekali-pakai cuma ada di komentar. Sesudah rotasi
      // diperketat, yang kalah menerima `invalid_refresh_token` untuk sesi yang sebenarnya
      // sehat-sehat saja, dan tanpa cabang ini ia akan memanggil clearSession() -- melempar
      // pengguna ke /login persis pada perbaikan yang seharusnya tidak terlihat olehnya.
      //
      // Tanda pembedanya sederhana dan tidak menebak: kalau nilai di localStorage sudah BERUBAH
      // sejak kita membacanya, tab lain baru saja merotasi dan menyimpan yang baru. Dicoba sekali
      // dengan nilai itu; kalau nilainya tidak berubah, token itu memang benar-benar mati dan
      // logout adalah jawaban yang benar.
      const current = localStorage.getItem(REFRESH_KEY);
      if (err.code === 'invalid_refresh_token' && current && current !== refreshToken) {
        const result = await postRefresh(current);
        persistSession(result);
        return result;
      }
      throw err;
    }
  });
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

// Every authenticated call goes through here: attach the bearer token, and on a 401 try one
// silent refresh-and-retry before giving up and forcing the app back to /login.
//
// CR-051: sejak ada refresh proaktif, cabang 401 di bawah adalah jaring pengaman, bukan jalur
// normal. Keduanya tetap ada dengan sengaja -- lihat komentar EXPIRY_SKEW_MS.
export async function apiFetch(path, options = {}) {
  if (options.auth !== false && path !== '/auth/refresh') await ensureFreshAccessToken();
  let res = await rawFetch(path, options);
  if (res.status === 401 && options.auth !== false && path !== '/auth/refresh') {
    try {
      await refreshSession();
    } catch {
      clearSession();
      return toResult(res);
    }
    res = await rawFetch(path, options);
  }
  return toResult(res);
}

// Same refresh-and-retry-once rule as apiFetch, for multipart uploads (payment proof,
// delivery confirmation signature).
export async function apiFetchForm(path, formData) {
  await ensureFreshAccessToken();
  let res = await rawFetchForm(path, formData);
  if (res.status === 401) {
    try {
      await refreshSession();
    } catch {
      clearSession();
      return toResult(res);
    }
    res = await rawFetchForm(path, formData);
  }
  return toResult(res);
}

// For binary downloads (invoice PDF, document attachments) -- returns a Blob instead of
// parsing JSON, but keeps the same auth-header-plus-refresh-retry contract as apiFetch.
export async function apiFetchBlob(path) {
  await ensureFreshAccessToken();
  let res = await rawFetch(path, {});
  if (res.status === 401) {
    try {
      await refreshSession();
    } catch {
      clearSession();
      throw new Error('Session expired');
    }
    res = await rawFetch(path, {});
  }
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    if (!isApiErrorPayload(payload)) throw networkUnreachableError();
    const error = new Error(payload.error.message);
    error.status = res.status;
    throw error;
  }
  return res.blob();
}

export async function bootstrapSession() {
  setState({ status: 'loading' });
  if (!localStorage.getItem(REFRESH_KEY)) {
    setState({ status: 'anonymous' });
    return;
  }
  try {
    await refreshSession();
  } catch {
    clearSession();
  }
}

export async function login({ email, password }) {
  const res = await rawFetch('/auth/login', { method: 'POST', body: { email, password }, auth: false });
  const result = await toResult(res);
  if (result.requires_2fa) return result;
  persistSession(result);
  return result;
}

export async function verifyTwoFactor({ challengeToken, code }) {
  const res = await rawFetch('/auth/2fa/verify', {
    method: 'POST',
    body: { challenge_token: challengeToken, code },
    auth: false,
  });
  const result = await toResult(res);
  persistSession(result);
  return result;
}

// The frontend never calls /auth/sso/google/start via fetch -- it's a full browser navigation
// (see LoginPage's "Sign in with Google" link). This constant is exported only so that link and
// the /sso/exchange call below stay in sync with rawFetch's own base URL.
export const GOOGLE_SSO_START_URL = `${API_BASE}/auth/sso/google/start`;

export async function exchangeSsoCode(code) {
  const res = await rawFetch('/auth/sso/exchange', { method: 'POST', body: { code }, auth: false });
  const result = await toResult(res);
  persistSession(result);
  return result;
}

export async function logout() {
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } finally {
    clearSession();
  }
}

export function changePassword(body) {
  return apiFetch('/auth/password/change', { method: 'POST', body });
}

// Always resolves (the backend responds 202 regardless of whether the email is registered).
export function forgotPassword({ email }) {
  return apiFetch('/auth/password/forgot', { method: 'POST', body: { email }, auth: false });
}

export function resetPassword({ resetToken, newPassword }) {
  return apiFetch('/auth/password/reset', {
    method: 'POST',
    body: { reset_token: resetToken, new_password: newPassword },
    auth: false,
  });
}

// Passwordless email-OTP login. Always resolves (the backend responds 202 regardless of whether
// the email is registered, active, or rate-limited) -- same shape as forgotPassword above.
export function requestOtpLogin({ email }) {
  return apiFetch('/auth/otp/request', { method: 'POST', body: { email }, auth: false });
}

export function resendOtpLogin({ email }) {
  return apiFetch('/auth/otp/resend', { method: 'POST', body: { email }, auth: false });
}

export async function verifyOtpLogin({ email, otp }) {
  const res = await rawFetch('/auth/otp/verify', { method: 'POST', body: { email, otp }, auth: false });
  const result = await toResult(res);
  persistSession(result);
  return result;
}

export function enableTwoFactor() {
  return apiFetch('/auth/2fa/enable', { method: 'POST' });
}

// Confirming enrollment (unlike the login-time challenge) issues a fresh session, since the
// backend's /auth/2fa/verify calls issueSession() again once the code checks out.
export async function confirmTwoFactorEnrollment(code) {
  const result = await apiFetch('/auth/2fa/verify', { method: 'POST', body: { code } });
  persistSession(result);
  return result;
}

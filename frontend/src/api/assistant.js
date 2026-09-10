import { apiFetch, getAuthState, refreshSession, clearSession, ensureFreshAccessToken } from './client';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';

export const getAssistantConfig = () => apiFetch('/assistant/config');
export const listConversations = () => apiFetch('/assistant/conversations');
export const getConversation = (id) => apiFetch(`/assistant/conversations/${id}`);
export const deleteConversation = (id) => apiFetch(`/assistant/conversations/${id}`, { method: 'DELETE' });

export const sendFeedback = (messageId, { rating, reason }) =>
  apiFetch(`/assistant/messages/${messageId}/feedback`, { method: 'POST', body: { rating, reason } });

// Aksi tulis (I-5). Ketiganya adalah permintaan HTTP terpisah dari /chat, dan itulah intinya:
// tidak ada jalur dari jawaban model ke eksekusi tanpa melewati salah satu panggilan di bawah,
// yang hanya terjadi karena pengguna mengklik tombol.
export const updateDraft = (draftId, payload) => apiFetch(`/assistant/drafts/${draftId}`, { method: 'PATCH', body: payload });
export const confirmDraft = (draftId) => apiFetch(`/assistant/drafts/${draftId}/confirm`, { method: 'POST' });
export const cancelDraft = (draftId) => apiFetch(`/assistant/drafts/${draftId}/cancel`, { method: 'POST' });

// SSE lewat fetch(), bukan EventSource: EventSource tidak bisa mengirim header Authorization
// (spec section 10.3), dan menaruh token di query string berarti token itu masuk ke access log
// setiap proxy yang dilewati. Konsekuensinya framing SSE-nya harus diurai sendiri di sini.
function parseSseChunk(buffer, onEvent) {
  // Satu event SSE berakhir pada baris kosong. Sisa buffer setelah pemisah terakhir adalah event
  // yang belum utuh -- dikembalikan untuk digabung dengan chunk berikutnya, bukan dibuang.
  const parts = buffer.split('\n\n');
  const remainder = parts.pop();

  for (const part of parts) {
    let event = 'message';
    let data = '';
    for (const line of part.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!data) continue;
    try {
      onEvent(event, JSON.parse(data));
    } catch {
      // Satu event rusak tidak boleh menjatuhkan jawaban yang sudah separuh tampil.
    }
  }
  return remainder;
}

function postChat(body, signal) {
  const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
  const { accessToken } = getAuthState();
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return fetch(`${API_BASE}/assistant/chat`, { method: 'POST', headers, body: JSON.stringify(body), signal });
}

async function toApiError(res) {
  const payload = await res.json().catch(() => null);
  const error = new Error(payload?.error?.message || 'Assistant request failed');
  error.status = res.status;
  error.code = payload?.error?.code || 'internal_error';
  return error;
}

/**
 * Mengirim satu pesan dan mengalirkan balasannya.
 *
 * onEvent(name, data) menerima kontrak event section 10.3: token, reset, tool_call, card,
 * done, error. `reset` berarti teks yang sudah mengalir untuk giliran ini adalah pemikiran
 * antara sebelum sebuah tool dipanggil -- buang, jangan tampilkan sebagai jawaban.
 */
export async function streamAssistantMessage({ conversationId, message, locale, route, onEvent, signal }) {
  const body = { message, locale, route };
  if (conversationId) body.conversation_id = conversationId;

  // CR-051: ikut memakai refresh proaktif yang sama dengan apiFetch. Jalur ini justru yang paling
  // sering dipakai sesudah tab dibiarkan lama (orang membuka chat saat butuh, bukan tiap menit),
  // jadi tanpa ini ia adalah tempat paling mungkin `401` masih muncul.
  await ensureFreshAccessToken();
  let res = await postChat(body, signal);

  // Kontrak refresh 401 sekali-lalu-retry yang sama seperti apiFetch. Aman diulang karena
  // kegagalan terjadi SEBELUM header SSE tertulis: backend sengaja menunda menulis header
  // sampai event pertama, jadi 401 di sini berarti belum ada satu token pun yang terkirim.
  if (res.status === 401) {
    try {
      await refreshSession();
    } catch {
      clearSession();
      throw await toApiError(res);
    }
    res = await postChat(body, signal);
  }

  if (!res.ok) throw await toApiError(res);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = parseSseChunk(buffer, onEvent);
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

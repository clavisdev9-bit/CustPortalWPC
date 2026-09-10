import { apiFetch } from './client';

// Konfigurasi asisten (platform admin). Perhatikan: tidak ada satu pun endpoint di sini yang
// mengembalikan API key -- backend hanya melaporkan `has_api_key` (boolean).
export const listAssistantSettings = () => apiFetch('/admin/assistant/settings');
export const saveAssistantSettings = (body) => apiFetch('/admin/assistant/settings', { method: 'PUT', body });

// Konfigurasi Provider AI (My Account > Setting) -- satu baris per provider (claude/gemini/ollama),
// terpisah dari settings di atas yang hanya menyimpan provider AKTIF + parameter bersama.
export const listAssistantProviderConfigs = () => apiFetch('/admin/assistant/provider-configs');
export const saveAssistantProviderConfig = (body) => apiFetch('/admin/assistant/provider-configs', { method: 'PUT', body });
// CR-048. Daftar model milik satu provider, ditanyakan backend ke provider-nya sendiri. Selalu
// 200: kalau providernya tidak bisa dihubungi (API key kosong, jaringan mati, daemon Ollama belum
// jalan) yang kembali adalah `source: 'fallback'` + `warning` yang harus ditampilkan apa adanya,
// bukan error. `refresh` melewati cache 10 menit di backend.
// CR-049. Test Connection satu provider. Backend memakai endpoint list-model provider (bukan
// panggilan chat percobaan -- lihat assistantProviderTest), jadi tombol ini tidak menghabiskan
// token berapa kali pun ditekan. Selalu 200 selama providernya dikenal: `status` bisa
// `connected` / `degraded` / `error` / `not_configured`, dan hasilnya ikut tersimpan di baris
// config sebagai health_* sehingga kartu provider tetap menampilkannya setelah halaman dimuat ulang.
export const testAssistantProviderConnection = (provider) =>
  apiFetch(`/admin/assistant/provider-configs/${provider}/test-connection`, { method: 'POST' });
export const listAssistantProviderModels = (provider, { refresh = false } = {}) =>
  apiFetch(`/admin/assistant/provider-configs/${provider}/models${refresh ? '?refresh=1' : ''}`);

export const listAssistantPrompts = (params = {}) => {
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  return apiFetch(`/admin/assistant/prompts${query ? `?${query}` : ''}`);
};
export const createAssistantPrompt = (body) => apiFetch('/admin/assistant/prompts', { method: 'POST', body });
export const activateAssistantPrompt = (id) => apiFetch(`/admin/assistant/prompts/${id}/activate`, { method: 'POST' });

export const listAssistantTools = () => apiFetch('/admin/assistant/tools');
export const saveAssistantTool = (body) => apiFetch('/admin/assistant/tools', { method: 'PUT', body });

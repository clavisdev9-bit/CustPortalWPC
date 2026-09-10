import { apiFetch } from './client';

// Platform-admin only (backend: requirePlatformAdmin). Credential/webhook_secret are never
// returned by any of these -- see odooConnectionController.js's toDto().
export const listOdooConnections = () => apiFetch('/admin/odoo-connections');
// CR-044 "Check Connection": validates a credential against Odoo without saving anything, and
// returns the company list to pick from in the same round trip. Body: { url, username, auth_type,
// credential, database? } -- or { connection_id, ... } to re-check a saved connection with its
// stored credential (leave `credential` out). A 200 can still be `status: 'database_required'`:
// reachable Odoo, but the database name has to be supplied before anything can be authenticated.
export const checkOdooConnection = (body) => apiFetch('/admin/odoo-connections/check-connection', { method: 'POST', body });
// Only reached after a successful check: the backend re-verifies and refuses to store a
// connection Odoo rejects, so a 422 here means the credential stopped working since the check.
export const createOdooConnection = (body) => apiFetch('/admin/odoo-connections', { method: 'POST', body });
export const updateOdooConnection = (id, body) => apiFetch(`/admin/odoo-connections/${id}`, { method: 'PATCH', body });
export const testOdooConnection = (id) => apiFetch(`/admin/odoo-connections/${id}/test-connection`, { method: 'POST' });
export const listOdooConnectionCompanies = (id) => apiFetch(`/admin/odoo-connections/${id}/companies`);
// `companyIds` re-runs the "Select Company" step for a saved connection (rows not listed come
// back is_active=false). Omit it to just refresh names/currencies and keep the current selection.
export const syncOdooConnectionCompanies = (id, companyIds = null) =>
  apiFetch(`/admin/odoo-connections/${id}/sync-companies`, {
    method: 'POST',
    body: companyIds ? { company_ids: companyIds } : {},
  });
// BUG-24: bulk-imports every existing Odoo "Portal" contact (res.users share=true) into
// portal_users -- returns one row per contact with status provisioned/already_provisioned/skipped_conflict.
export const syncOdooConnectionUsers = (id) => apiFetch(`/admin/odoo-connections/${id}/sync-users`, { method: 'POST' });
// Returns { webhook_url } -- the only two responses that ever include it (create is the other).
// Rotating immediately invalidates whatever URL/secret is currently configured in Odoo.
export const rotateOdooConnectionWebhook = (id) => apiFetch(`/admin/odoo-connections/${id}/webhook-secret/rotate`, { method: 'POST' });
// Menghentikan/menyalakan pemakaian koneksi tanpa menghapusnya (`is_enabled`, migrasi 0015).
// Berbeda dari `status`, yang ditulis otomatis dari hasil kontak terakhir ke Odoo dan bukan
// keputusan siapa pun -- dua kolom, dua arti, keduanya tampil di tabel.
//
// Disable memutus SEMUA pelanggan yang terpetakan ke koneksi itu (503 di setiap halaman mereka),
// jadi pemanggilnya wajib mengonfirmasi dulu. Tidak menelepon Odoo, jadi cepat dan tidak bisa
// gagal karena Odoo-nya sedang mati -- justru itu keadaan yang paling sering memicunya.
export const disableOdooConnection = (id) => apiFetch(`/admin/odoo-connections/${id}/disable`, { method: 'POST' });
export const enableOdooConnection = (id) => apiFetch(`/admin/odoo-connections/${id}/enable`, { method: 'POST' });

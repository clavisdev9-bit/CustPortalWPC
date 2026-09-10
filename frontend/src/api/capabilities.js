import { apiFetch } from './client';

// BUG-31: modul Odoo mana yang terpasang di koneksi perusahaan yang sedang aktif. Dipakai
// AppShell untuk menyembunyikan menu yang tidak akan pernah bisa bekerja. Backend sengaja tidak
// pernah menggagalkan endpoint ini (lihat capabilityController.js), jadi tidak ada penanganan
// error khusus di sini -- pemanggilnya yang memutuskan apa arti "belum termuat".
export const listCapabilities = () => apiFetch('/capabilities');

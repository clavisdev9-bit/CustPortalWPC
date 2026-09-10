-- Customer Population / Installed Base, Fase 1 (Docs/CR/customer_population_installed_base.md).
--
-- Hanya equipment.view yang diseed di sini. equipment.correct (permintaan koreksi data, section 7
-- CR) menunggu Fase 4 -- endpoint POST /equipment/:id/corrections belum ada di Fase 1, dan
-- CLAUDE.md rule #3 melarang kode permission yang belum dipakai. Seed-nya menyusul di migrasi
-- Fase 4 bersama endpoint itu sendiri.
--
-- equipment.view diberikan ke keempat role pelanggan: registry installed base adalah data
-- referensi yang membantu semua orang di sisi pelanggan (Procurement memesan part yang benar,
-- Finance memverifikasi klaim garansi, Viewer memeriksa aset) -- sama seperti rasionalnya di CR
-- section 14.

INSERT INTO portal_permissions (code, name, module) VALUES
  ('equipment.view', 'View installed base (owned machines & serviceable parts)', 'equipment');

INSERT INTO portal_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM portal_roles r, portal_permissions p
WHERE p.code = 'equipment.view'
  AND r.name IN ('Customer Admin', 'Finance', 'Procurement', 'Viewer');

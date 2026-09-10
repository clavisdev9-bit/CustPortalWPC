-- Fase 4 (Docs/CR/customer_population_installed_base.md) -- permintaan koreksi data installed
-- base. Deferred dari seed 0017: endpoint POST /equipment/:id/corrections baru ada sekarang.
--
-- equipment.correct SENGAJA hanya Customer Admin, alasan sama seperti rma.create dan
-- warranty.create: ia mengubah catatan aset yang berkonsekuensi komersial (klaim garansi, lingkup
-- kontrak servis). Role lain mengajukannya lewat tiket biasa dan staf yang mengonversi.

INSERT INTO portal_permissions (code, name, module) VALUES
  ('equipment.correct', 'Submit installed-base data correction requests', 'equipment');

INSERT INTO portal_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM portal_roles r, portal_permissions p
WHERE p.code = 'equipment.correct'
  AND r.name = 'Customer Admin';

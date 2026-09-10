-- AI Assistant ("Asisten Portal") -- permission akses widget (D6).
--
-- Catatan penomoran: Docs/CR/customer_portal_ai_assistant.md section 5 menyebut file ini
-- `0011_assistant_permissions.sql`, tapi 0011_maintenance_permissions.sql sudah lebih dulu
-- memakai nomor itu setelah spec ditulis. Seed dijalankan berurutan nama file
-- (scripts/migrate.js), jadi nomornya digeser ke 0012 -- isinya tidak berubah.

INSERT INTO portal_permissions (code, name, module) VALUES
  ('assistant.use', 'Use the AI portal assistant', 'assistant');

-- Keempat role yang menghadap customer. Kemampuan asisten tetap dibatasi permission per-tool
-- (toolRegistry menyaring daftar tool terhadap permission user sebelum LLM melihatnya), jadi
-- memberi akses luas di sini aman: 'assistant.use' hanya membuka pintu widget, bukan datanya.
--
-- 'Staff (Internal)' SENGAJA dikecualikan: itu staf vendor internal (seed 0008), bukan
-- pelanggan. Mereka tidak punya identity_mapping ke sebuah res.partner pelanggan, sehingga
-- resolveOdooContext akan melempar 403 no_identity_mapping -- asisten akan tampak rusak,
-- bukan berguna. Kalau nanti dibutuhkan asisten untuk staf, itu fitur berbeda dengan model
-- scoping yang berbeda.
INSERT INTO portal_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM portal_roles r, portal_permissions p
WHERE r.name IN ('Customer Admin', 'Procurement', 'Finance', 'Viewer')
  AND p.code = 'assistant.use';

-- Catatan D6 (spec section 12): 'ticket.view' saat ini hanya dimiliki Customer Admin
-- (seed 0004_helpdesk_permissions.sql). Akibatnya user Finance/Procurement/Viewer akan punya
-- asisten yang tidak bisa menunjukkan tiket mereka sendiri -- tool tiket tidak akan pernah
-- dikirim ke model untuk mereka. Itu keputusan produk terpisah dan SENGAJA tidak diubah di
-- sini; mengubahnya berarti memperluas akses helpdesk di seluruh portal, bukan hanya di widget.

-- Membuka akses helpdesk ke seluruh role pelanggan (keputusan A).
--
-- Latar belakangnya: Asisten Portal Fase 2 bisa menyiapkan draf tiket, tapi toolRegistry hanya
-- mengirim tool `draft_ticket` ke model kalau penggunanya punya 'ticket.create'. Sebelum seed ini,
-- permission tersebut hanya dimiliki Customer Admin (seed 0004), sehingga bagi Finance,
-- Procurement, dan Viewer asisten akan menolak membantu membuat tiket -- benar secara teknis,
-- tapi kebalikan dari yang diinginkan: justru merekalah yang paling sering menemui masalah
-- sehari-hari dan tidak punya jalur melapor.
--
-- Kenapa hanya tiga permission ini, dan bukan seluruh modul helpdesk:
--
--   ticket.view    Sekelas dengan invoice.view / order.view / quotation.view yang memang sudah
--                  dimiliki keempat role -- membaca data organisasi sendiri. Tanpa ini, ketiga
--                  role bahkan tidak bisa melihat tiket yang baru saja mereka buat.
--   ticket.create  Tiket adalah PERMINTAAN BANTUAN, bukan komitmen komersial. Risiko terburuknya
--                  derau di antrean; biaya menolaknya adalah pengguna tidak bisa melaporkan
--                  masalah sama sekali.
--   ticket.reply   Konsekuensi wajib dari ticket.create: kalau bisa membuat tapi tidak bisa
--                  menjawab pertanyaan lanjutan staf, tiketnya mandek di pertanyaan pertama.
--
-- Yang SENGAJA tidak diperluas, dan alasannya bukan kelalaian:
--
--   ticket.close       Menutup tiket orang lain di organisasi yang sama bersifat merusak.
--   rma.create         Berkonsekuensi komersial -- refund dan penggantian barang. Sekelas dengan
--   warranty.create    request.create yang juga sengaja dibatasi (seed 0002).
--
-- Konsekuensi desain yang mengikuti: untuk pengguna non-admin yang minta refund, asisten tidak
-- akan menawarkan draf RMA (tool-nya tidak dikirim ke model). Ia membuat tiket umum, dan staf
-- yang mengonversinya jadi RMA. Itu jalur yang benar, bukan jalan pintas.
--
-- Catatan cakupan: ini memperluas akses di SELURUH portal, bukan hanya di widget asisten --
-- POST /tickets biasa ikut terbuka untuk ketiga role. Itu memang yang dimaksud.

-- ON CONFLICT DO NOTHING karena Customer Admin sudah memegang ketiganya dari seed 0004, dan
-- primary key (role_id, permission_id) akan menolak baris kembar. Menyertakan Customer Admin di
-- daftar -- alih-alih mengecualikannya -- membuat seed ini menyatakan keadaan akhir yang
-- diinginkan secara utuh, bukan delta yang hanya bisa dipahami bersama file lain.
INSERT INTO portal_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM portal_roles r, portal_permissions p
WHERE r.name IN ('Customer Admin', 'Finance', 'Procurement', 'Viewer')
  AND p.code IN ('ticket.view', 'ticket.create', 'ticket.reply')
ON CONFLICT (role_id, permission_id) DO NOTHING;

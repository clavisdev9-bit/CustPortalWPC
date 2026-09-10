-- Prompt untuk kegagalan TEKNIS, dipisahkan dari penolakan cakupan data.
--
-- Sebelum ini keduanya memakai teks yang sama (`key = 'refusal'`), dan itu menghasilkan jawaban
-- yang menyesatkan di lapangan. Contoh nyata yang dilaporkan:
--
--   Pengguna : "saya ada keluhan barang rusak bisa bantu saya claim garansi?"
--   Asisten  : "Maaf, saya belum punya data untuk menjawab itu. Coba tanyakan tentang invoice
--               outstanding, pesanan, pengiriman, atau riwayat pembelian Anda..."
--
-- Pertanyaannya justru hal yang asisten BISA bantu. Yang sebenarnya terjadi: model mengembalikan
-- jawaban kosong, lalu kode memperlakukannya sama dengan "tidak punya data" dan mengarahkan
-- pengguna ke daftar topik yang tidak ada hubungannya dengan keluhannya.
--
-- Dua situasi itu berbeda dan harus terdengar berbeda:
--   'refusal'     -- asisten memang tidak punya datanya, atau pertanyaannya di luar cakupan.
--                    Menawarkan jalan lain: modul terkait, atau membuat tiket.
--   'interrupted' -- jawabannya gagal terbentuk karena sebab teknis. Yang benar adalah mengaku
--                    dan meminta pengguna mengulang, BUKAN mengarahkan ke topik lain seolah
--                    pertanyaannya salah alamat.

INSERT INTO assistant_prompts (key, locale, version, body, is_active) VALUES ('interrupted', 'id', 1, $p$Maaf, jawaban saya barusan terputus sebelum sempat tersusun. Boleh tolong kirim ulang pesan Anda? Saya lanjutkan dari situ.$p$, true);

INSERT INTO assistant_prompts (key, locale, version, body, is_active) VALUES ('interrupted', 'en', 1, $p$Sorry, my reply was cut off before it finished. Could you send your message again? I will pick up from there.$p$, true);

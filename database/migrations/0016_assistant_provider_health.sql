-- CR-049. Halaman Konfigurasi Provider AI harus bisa menjawab dua pertanyaan yang selama ini
-- tidak punya tempat penyimpanan sama sekali:
--
--   1. "Provider ini benar-benar bisa dihubungi tidak?"  -> health_* di bawah
--   2. "Sejak kapan provider ini yang dipakai?"          -> assistant_settings.provider_activated_at
--
-- Pemisahan yang sama dengan odoo_connections sesudah CR-045/CR-047, dan alasannya sama persis:
-- ada dua fakta ortogonal yang tidak boleh berbagi satu kolom.
--
--   assistant_settings.provider          -> provider mana yang AKTIF   (keputusan manusia)
--   assistant_provider_configs.health_*  -> apa kata provider terakhir (ditulis mesin)
--
-- "Aktif" dan "Connected" adalah dua hal berbeda, dan justru kombinasinya yang informatif:
-- Gemini aktif + error berarti asisten sedang rusak sekarang; Claude tidak aktif + connected
-- berarti dia siap dijadikan cadangan. Menyatukan keduanya ke satu kolom status akan menghapus
-- tepat perbedaan yang membuat halaman ini berguna.
--
-- Health ditempel di assistant_provider_configs, bukan di assistant_settings, karena ketiga
-- provider bisa diuji sendiri-sendiri sementara hanya satu yang aktif -- dan hasil uji provider
-- yang belum aktif itulah yang dibutuhkan admin sebelum berpindah.
--
-- 'degraded' bukan hiasan: ia menampung satu-satunya kegagalan yang sering terjadi tapi tidak
-- terlihat seperti kegagalan -- kredensial benar, provider hidup, tapi MODEL yang dikonfigurasi
-- tidak ada di daftar yang provider itu kembalikan. Tanpa status ini, satu-satunya pilihan adalah
-- menyebutnya 'connected' (bohong yang menyenangkan) atau 'error' (bohong yang menakutkan).
--
-- Tidak ada nilai DEFAULT: NULL berarti "belum pernah diuji", keadaan yang berbeda dari ketiganya
-- dan harus tetap bisa dibedakan setelah migrasi ini jalan di baris yang sudah ada.
ALTER TABLE assistant_provider_configs
  ADD COLUMN IF NOT EXISTS health_status     VARCHAR(20)
    CHECK (health_status IN ('connected', 'degraded', 'error')),
  ADD COLUMN IF NOT EXISTS health_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS health_error      TEXT,
  ADD COLUMN IF NOT EXISTS health_latency_ms INTEGER;

-- updated_at pada baris ini berubah setiap kali APA PUN di settings disimpan (kuota, temperature,
-- toggle aktif/mati), jadi ia tidak bisa menjawab "sejak kapan provider ini dipakai" -- kolom
-- sendiri, ditulis hanya saat `provider` benar-benar berubah nilainya.
-- NULL untuk baris yang sudah ada: kapan provider aktif sekarang dipilih memang tidak diketahui,
-- dan menebaknya dengan updated_at akan menampilkan tanggal yang salah dengan penuh percaya diri.
ALTER TABLE assistant_settings
  ADD COLUMN IF NOT EXISTS provider_activated_at TIMESTAMPTZ;

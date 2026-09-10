-- "Konfigurasi Provider AI" (My Account > Setting), lihat cr.md untuk detail fitur -- ini
-- memperluas presedensi konfigurasi asisten di section 6.2 Docs/CR/customer_portal_ai_assistant.md.
--
-- Sebelum tabel ini, satu baris assistant_settings (0010_assistant.sql) memegang SATU slot
-- provider/model/encrypted_api_key sekaligus. Berganti provider aktif berarti field model dan
-- API key provider sebelumnya tertimpa -- tidak ada tempat menyimpan konfigurasi Anthropic,
-- Google, dan Ollama secara bersamaan. Tabel ini memberi tiap provider baris sendiri, jadi
-- berganti provider aktif tidak lagi menghapus konfigurasi provider lain.
--
-- assistant_settings.provider TETAP dipakai sebagai SELECTOR provider aktif -- kolom itu tidak
-- diubah maupun dihapus. assistant_settings.model/base_url/encrypted_api_key (kolom lama) juga
-- TIDAK dihapus: instalasi yang sudah live sebelum migrasi ini (Ollama produksi, D1 CR asisten)
-- masih mengisinya, dan assistantConfigService.resolve membaca baris tabel ini SEBAGAI LAPIS
-- PERTAMA, baru turun ke kolom lama sebagai fallback kalau providernya belum punya baris di sini.
-- Ini disengaja, bukan duplikasi yang lupa dibereskan -- lihat komentar resolve() untuk urutan
-- presedensi lengkapnya.
--
-- Kolom ollama_* HANYA berarti untuk provider='ollama' (NULL untuk claude/gemini). Tidak
-- dipecah ke tabel terpisah supaya upsert satu provider tetap satu statement, mengikuti pola
-- assistant_settings.
CREATE TABLE assistant_provider_configs (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  odoo_connection_id       UUID REFERENCES odoo_connections(id) ON DELETE CASCADE,
  provider                 VARCHAR(40) NOT NULL CHECK (provider IN ('claude', 'gemini', 'ollama')),
  model                    VARCHAR(120),
  encrypted_api_key        TEXT,
  base_url                 VARCHAR(255),
  -- 'auto' = pakai Ollama Cloud kalau encrypted_api_key_cloud terisi, kalau tidak diteruskan ke
  -- daemon lokal (base_url). Diputuskan di assistantConfigService.resolve, bukan di sini.
  ollama_target            VARCHAR(10) NOT NULL DEFAULT 'auto'
                             CHECK (ollama_target IN ('auto', 'local', 'cloud')),
  ollama_model_manual      VARCHAR(120),
  encrypted_api_key_cloud  TEXT,
  base_url_cloud           VARCHAR(255),
  updated_by               UUID REFERENCES portal_users(id) ON DELETE SET NULL,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sama seperti assistant_settings: dua index PARSIAL, bukan satu UNIQUE biasa, karena NULL tidak
-- sama dengan NULL di Postgres -- tanpa ini, banyak baris global untuk provider yang sama bisa
-- lolos sekaligus dan "baris global mana yang menang" jadi tak tentu.
CREATE UNIQUE INDEX ux_assistant_provider_configs_global
  ON assistant_provider_configs (provider) WHERE odoo_connection_id IS NULL;
CREATE UNIQUE INDEX ux_assistant_provider_configs_connection
  ON assistant_provider_configs (odoo_connection_id, provider) WHERE odoo_connection_id IS NOT NULL;

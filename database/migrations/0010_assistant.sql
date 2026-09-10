-- AI Assistant ("Asisten Portal"), Docs/CR/customer_portal_ai_assistant.md -- Fase 1.
--
-- Catatan scoping: setiap tabel yang menyimpan jejak percakapan di-scope ke
-- (portal_user_id, odoo_connection_id) -- sama seperti rma_requests dan customer_requests.
-- Seorang user bisa punya identity_mapping ke lebih dari satu Odoo connection
-- (lihat src/services/odooContext.js), dan riwayat dari connection lain tidak boleh
-- muncul di bawah company yang sedang aktif. Ini aturan yang sama yang menyebabkan
-- BUG-08/BUG-13 di resolution.md.
--
-- Catatan konfigurasi: provider, model, prompt, dan daftar tool semuanya DATA di tabel-tabel
-- ini, bukan literal di dalam JS. Alasannya bukan kerapian -- prompt yang salah adalah insiden
-- produksi, dan memperbaikinya lewat deploy berarti downtime. Sebagai data, rollback = mengaktifkan
-- versi lama (satu UPDATE), dan perubahan model tidak perlu restart proses.

-- ---------------------------------------------------------------------------
-- Konfigurasi
-- ---------------------------------------------------------------------------

-- NULL odoo_connection_id = default global. Baris per-connection menimpanya (lihat
-- assistantConfigService.resolve, presedensi section 6.2). API key disimpan terenkripsi
-- memakai src/utils/crypto.js (AES-256-GCM), pola sama dengan
-- odoo_connections.encrypted_credential -- kunci dari env ENCRYPTION_KEY.
CREATE TABLE assistant_settings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  odoo_connection_id  UUID REFERENCES odoo_connections(id) ON DELETE CASCADE,
  provider            VARCHAR(40)  NOT NULL,
  model               VARCHAR(120) NOT NULL,
  base_url            VARCHAR(255),
  encrypted_api_key   TEXT,
  temperature         NUMERIC(3,2) NOT NULL DEFAULT 0.20,
  max_output_tokens   INTEGER      NOT NULL DEFAULT 1024,
  max_tool_iterations SMALLINT     NOT NULL DEFAULT 5,
  history_window      SMALLINT     NOT NULL DEFAULT 10,
  daily_message_quota INTEGER      NOT NULL DEFAULT 100,
  burst_per_minute    SMALLINT     NOT NULL DEFAULT 6,
  default_locale      VARCHAR(10)  NOT NULL DEFAULT 'id',
  enabled             BOOLEAN      NOT NULL DEFAULT false,
  updated_by          UUID REFERENCES portal_users(id) ON DELETE SET NULL,
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Dua index parsial, bukan satu UNIQUE biasa: di Postgres NULL tidak sama dengan NULL, jadi
-- UNIQUE (odoo_connection_id) sendirian akan mengizinkan banyak baris global sekaligus --
-- dan "config global mana yang menang" jadi tak tentu.
CREATE UNIQUE INDEX ux_assistant_settings_global
  ON assistant_settings ((odoo_connection_id IS NULL)) WHERE odoo_connection_id IS NULL;
CREATE UNIQUE INDEX ux_assistant_settings_connection
  ON assistant_settings (odoo_connection_id) WHERE odoo_connection_id IS NOT NULL;

-- Prompt sebagai data berversi, bukan string di dalam kode: memberi rollback satu klik,
-- jejak siapa mengubah apa, dan multi-bahasa lewat kolom locale (requirement 3 & 5).
CREATE TABLE assistant_prompts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key        VARCHAR(60)  NOT NULL,   -- 'system' | 'refusal' | 'ticket_intake' | 'starters'
  locale     VARCHAR(10)  NOT NULL,   -- 'id' | 'en'
  version    INTEGER      NOT NULL,
  body       TEXT         NOT NULL,
  is_active  BOOLEAN      NOT NULL DEFAULT false,
  created_by UUID REFERENCES portal_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (key, locale, version)
);

-- Hanya satu versi aktif per (key, locale). Ditegakkan DB, bukan kode: mengaktifkan versi baru
-- tanpa menonaktifkan yang lama adalah kesalahan yang tidak terlihat sampai jawaban asisten
-- berubah-ubah tanpa sebab.
CREATE UNIQUE INDEX ux_assistant_prompts_active
  ON assistant_prompts (key, locale) WHERE is_active;

-- Tool pun konfigurasi: bisa dimatikan per company tanpa deploy. permission_code memetakan
-- ke portal_permissions.code yang SUDAH ADA -- jangan mengarang kode permission baru.
-- Baris di sini bersifat OVERRIDE, bukan sumber kebenaran: tool yang tidak punya baris tetap
-- aktif dengan permission bawaan dari kode registry (lihat toolRegistry.listAvailableTools).
-- Kalau tabel ini yang jadi sumber kebenaran, menambah tool baru di kode akan diam-diam
-- tidak berfungsi sampai seseorang ingat menambah barisnya.
CREATE TABLE assistant_tools (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  odoo_connection_id   UUID REFERENCES odoo_connections(id) ON DELETE CASCADE,
  tool_name            VARCHAR(60) NOT NULL,
  permission_code      VARCHAR(60) NOT NULL,
  description_override TEXT,
  enabled              BOOLEAN     NOT NULL DEFAULT true,
  UNIQUE (odoo_connection_id, tool_name)
);

-- ---------------------------------------------------------------------------
-- Percakapan
-- ---------------------------------------------------------------------------

CREATE TABLE assistant_conversations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id     UUID NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  odoo_connection_id UUID NOT NULL REFERENCES odoo_connections(id) ON DELETE CASCADE,
  locale             VARCHAR(10) NOT NULL DEFAULT 'id',
  title              VARCHAR(200),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at          TIMESTAMPTZ,
  anonymized_at      TIMESTAMPTZ            -- diisi oleh job retensi 90 hari (D5, Fase 5)
);

CREATE INDEX ix_assistant_conversations_user
  ON assistant_conversations (portal_user_id, odoo_connection_id, last_message_at DESC);

-- SENGAJA tidak menyimpan payload tool mentah: itu akan menduplikasi data keuangan customer
-- dari Odoo ke portal DB dan memperluas permukaan kepatuhan tanpa manfaat jelas (D5).
-- Yang disimpan: nama tool, argumen, dan ringkasan pendek. Data aktual dirender ulang dari
-- Odoo saat riwayat dibuka -- itulah gunanya card_ref (id record), bukan card_data.
CREATE TABLE assistant_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  role            VARCHAR(12) NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content         TEXT,
  tool_name       VARCHAR(60),
  tool_args       JSONB,
  tool_summary    TEXT,
  card_type       VARCHAR(40),          -- komponen frontend untuk render deterministik
  card_ref        JSONB,                -- id record untuk fetch ulang, BUKAN datanya
  model           VARCHAR(120),
  token_in        INTEGER,
  token_out       INTEGER,
  latency_ms      INTEGER,
  error_code      VARCHAR(60),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_assistant_messages_conversation
  ON assistant_messages (conversation_id, created_at);

-- Kuota harian (section 10.4) dihitung dengan menghitung baris role='user' milik satu user
-- hari ini. Tanpa index ini, setiap pesan masuk memicu scan penuh assistant_messages.
CREATE INDEX ix_assistant_messages_quota
  ON assistant_messages (conversation_id, role, created_at DESC) WHERE role = 'user';

-- Draf aksi tulis disimpan SERVER-SIDE, bukan dikembalikan ke klien lalu dikirim balik.
-- Ini memberi jejak audit yang utuh dan memastikan payload yang dieksekusi adalah payload
-- yang ditinjau user (I-5). Tabel dibuat sekarang meski aksi tulis baru ada di Fase 2:
-- migrasi bersifat additif dan tidak boleh diedit setelah dijalankan, jadi memecahnya jadi
-- dua migrasi hanya menambah file tanpa menambah keamanan.
CREATE TABLE assistant_action_drafts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  portal_user_id  UUID NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  action          VARCHAR(40) NOT NULL,   -- 'create_ticket' | 'create_rma' | 'create_warranty'
  payload         JSONB       NOT NULL,
  status          VARCHAR(12) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'confirmed', 'cancelled', 'expired')),
  result_ref      VARCHAR(100),           -- id tiket/RMA hasil eksekusi
  expires_at      TIMESTAMPTZ NOT NULL,
  confirmed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_assistant_drafts_pending
  ON assistant_action_drafts (portal_user_id, status, created_at DESC);

-- UNIQUE (message_id): satu pesan satu penilaian. Menekan 👍 lalu 👎 mengubah baris yang sama
-- (ON CONFLICT DO UPDATE), bukan menumpuk riwayat kebimbangan.
CREATE TABLE assistant_feedback (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES assistant_messages(id) ON DELETE CASCADE,
  rating     SMALLINT NOT NULL CHECK (rating IN (-1, 1)),
  reason     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id)
);

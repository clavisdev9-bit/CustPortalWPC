const pool = require('../db/pool');

// Konfigurasi asisten: settings (provider/model/kuota), prompts (berversi), dan override tool.
// Dipisah dari assistantRepository karena umurnya berbeda -- yang ini dibaca hampir setiap
// request lalu di-cache, yang itu ditulis setiap pesan.

// ---------------------------------------------------------------- settings --

// Baris global (odoo_connection_id IS NULL) dan baris per-connection dibaca sekaligus supaya
// assistantConfigService bisa menyusun presedensi section 6.2 tanpa dua round-trip DB.
// ORDER BY memastikan baris per-connection selalu di indeks 0 kalau ada.
async function findSettings(odooConnectionId) {
  const { rows } = await pool.query(
    `SELECT * FROM assistant_settings
     WHERE odoo_connection_id = $1 OR odoo_connection_id IS NULL
     ORDER BY (odoo_connection_id IS NULL)`,
    [odooConnectionId]
  );
  return {
    connection: rows.find((r) => r.odoo_connection_id === odooConnectionId) || null,
    global: rows.find((r) => r.odoo_connection_id === null) || null,
  };
}

async function listSettings() {
  const { rows } = await pool.query(
    `SELECT s.*, c.name AS connection_name
     FROM assistant_settings s
     LEFT JOIN odoo_connections c ON c.id = s.odoo_connection_id
     ORDER BY (s.odoo_connection_id IS NULL) DESC, c.name`
  );
  return rows;
}

const SETTINGS_FIELDS = [
  'provider', 'model', 'base_url', 'encrypted_api_key', 'temperature', 'max_output_tokens',
  'max_tool_iterations', 'history_window', 'daily_message_quota', 'burst_per_minute',
  'default_locale', 'enabled',
  // CR-049: ditulis hanya saat nilai `provider` benar-benar berubah (lihat saveSettings), supaya
  // ia menjawab 'sejak kapan provider ini dipakai' dan bukan 'kapan settings terakhir disentuh'.
  'provider_activated_at',
];

// Upsert per scope: ON CONFLICT tidak bisa dipakai di sini karena keunikannya ditegakkan dua
// index PARSIAL (lihat 0010_assistant.sql), dan ON CONFLICT butuh constraint/index penuh.
// Jadi UPDATE dulu, INSERT kalau tidak ada baris yang tersentuh. `$1::uuid IS NULL` di WHERE
// menangani scope global, karena `odoo_connection_id = NULL` tidak pernah cocok dengan apa pun.
async function upsertSettings(odooConnectionId, patch, updatedBy) {
  const fields = SETTINGS_FIELDS.filter((f) => patch[f] !== undefined);

  if (fields.length) {
    const setClause = fields.map((f, i) => `${f} = $${i + 3}`).join(', ');
    const { rows } = await pool.query(
      `UPDATE assistant_settings SET ${setClause}, updated_by = $2, updated_at = now()
       WHERE ($1::uuid IS NULL AND odoo_connection_id IS NULL) OR odoo_connection_id = $1
       RETURNING *`,
      [odooConnectionId, updatedBy, ...fields.map((f) => patch[f])]
    );
    if (rows.length) return rows[0];
  }

  const columns = ['odoo_connection_id', 'updated_by', ...fields];
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await pool.query(
    `INSERT INTO assistant_settings (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`,
    [odooConnectionId, updatedBy, ...fields.map((f) => patch[f])]
  );
  return rows[0];
}

// --------------------------------------------------------- provider configs --

const PROVIDERS = ['claude', 'gemini', 'ollama'];

// Sama pola findSettings: baris global dan per-connection dibaca sekaligus supaya resolve()
// bisa menyusun presedensinya tanpa round-trip DB kedua.
async function findProviderConfig(odooConnectionId, provider) {
  const { rows } = await pool.query(
    `SELECT * FROM assistant_provider_configs
     WHERE provider = $2 AND (odoo_connection_id = $1 OR odoo_connection_id IS NULL)
     ORDER BY (odoo_connection_id IS NULL)`,
    [odooConnectionId, provider]
  );
  return {
    connection: rows.find((r) => r.odoo_connection_id === odooConnectionId) || null,
    global: rows.find((r) => r.odoo_connection_id === null) || null,
  };
}

// Selalu mengembalikan satu baris per provider dikenal (PROVIDERS), termasuk provider yang belum
// pernah disimpan -- kalau tidak, provider yang belum disentuh admin akan hilang dari daftar UI
// alih-alih tampil sebagai "belum dikonfigurasi", dan operator tidak akan tahu bedanya dari
// respons API kosong.
async function listProviderConfigs(odooConnectionId) {
  const { rows } = await pool.query(
    `SELECT * FROM assistant_provider_configs
     WHERE ($1::uuid IS NULL AND odoo_connection_id IS NULL) OR odoo_connection_id = $1`,
    [odooConnectionId]
  );
  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  return PROVIDERS.map((provider) => byProvider.get(provider) || { provider, odoo_connection_id: odooConnectionId || null });
}

const PROVIDER_CONFIG_FIELDS = [
  'model', 'encrypted_api_key', 'base_url',
  'ollama_target', 'ollama_model_manual', 'encrypted_api_key_cloud', 'base_url_cloud',
];

// UPDATE-lalu-INSERT, pola sama upsertSettings: ON CONFLICT butuh constraint/index penuh, dan
// keunikannya di sini ditegakkan dua index PARSIAL (lihat 0012_assistant_provider_configs.sql).
async function upsertProviderConfig(odooConnectionId, provider, patch, updatedBy) {
  const fields = PROVIDER_CONFIG_FIELDS.filter((f) => patch[f] !== undefined);

  if (fields.length) {
    const setClause = fields.map((f, i) => `${f} = $${i + 4}`).join(', ');
    const { rows } = await pool.query(
      `UPDATE assistant_provider_configs SET ${setClause}, updated_by = $3, updated_at = now()
       WHERE provider = $2 AND (($1::uuid IS NULL AND odoo_connection_id IS NULL) OR odoo_connection_id = $1)
       RETURNING *`,
      [odooConnectionId, provider, updatedBy, ...fields.map((f) => patch[f])]
    );
    if (rows.length) return rows[0];
  }

  const columns = ['odoo_connection_id', 'provider', 'updated_by', ...fields];
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await pool.query(
    `INSERT INTO assistant_provider_configs (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`,
    [odooConnectionId, provider, updatedBy, ...fields.map((f) => patch[f])]
  );
  return rows[0];
}

// CR-049. Health punya jalur tulisnya sendiri, terpisah dari upsertProviderConfig, karena
// penulisnya berbeda: yang satu keputusan admin (wajar menggerakkan updated_at/updated_by, yang
// ditampilkan UI sebagai "kunci diperbarui"), yang satu hasil pemeriksaan mesin. Kalau keduanya
// lewat pintu yang sama, satu kali Test Connection akan membuat baris itu terlihat seperti baru
// saja disunting orang -- persis informasi yang salah pada kolom yang dibaca untuk audit.
//
// `null` di keempat kolom berarti "lupakan hasil pemeriksaan sebelumnya" (dipakai saat provider
// kembali ke keadaan belum dikonfigurasi), jadi patch-nya sengaja ditulis penuh, bukan parsial.
async function recordProviderHealth(odooConnectionId, provider, health) {
  const values = [
    odooConnectionId,
    provider,
    health.health_status ?? null,
    health.health_checked_at ?? null,
    health.health_error ?? null,
    health.health_latency_ms ?? null,
  ];

  const { rows } = await pool.query(
    `UPDATE assistant_provider_configs
        SET health_status = $3, health_checked_at = $4, health_error = $5, health_latency_ms = $6
      WHERE provider = $2 AND (($1::uuid IS NULL AND odoo_connection_id IS NULL) OR odoo_connection_id = $1)
      RETURNING *`,
    values
  );
  if (rows.length) return rows[0];

  // Provider yang belum pernah disimpan sama sekali tetap bisa diuji (Ollama lokal tidak butuh
  // kredensial apa pun), jadi barisnya dibuat di sini supaya hasilnya punya tempat menempel.
  const { rows: inserted } = await pool.query(
    `INSERT INTO assistant_provider_configs
       (odoo_connection_id, provider, health_status, health_checked_at, health_error, health_latency_ms)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    values
  );
  return inserted[0];
}

// ----------------------------------------------------------------- prompts --

async function findActivePrompts(locale) {
  const { rows } = await pool.query(
    'SELECT key, body FROM assistant_prompts WHERE locale = $1 AND is_active',
    [locale]
  );
  return Object.fromEntries(rows.map((r) => [r.key, r.body]));
}

async function listPrompts({ key, locale } = {}) {
  const conditions = [];
  const params = [];
  if (key) {
    params.push(key);
    conditions.push(`key = $${params.length}`);
  }
  if (locale) {
    params.push(locale);
    conditions.push(`locale = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT * FROM assistant_prompts ${where} ORDER BY key, locale, version DESC`,
    params
  );
  return rows;
}

async function findPromptById(id) {
  const { rows } = await pool.query('SELECT * FROM assistant_prompts WHERE id = $1', [id]);
  return rows[0] || null;
}

// Versi baru selalu dibuat non-aktif: menulis prompt dan mengaktifkannya adalah dua keputusan
// berbeda, dan menggabungkannya berarti typo langsung tayang ke pelanggan.
// Cast $1/$2 eksplisit: keduanya dipakai di dua konteks sekaligus -- sebagai nilai yang
// di-INSERT ke kolom VARCHAR, dan sebagai pembanding di dalam sub-SELECT. Tanpa cast, Postgres
// menyimpulkan `text` di satu tempat dan `character varying` di tempat lain, lalu menolak
// seluruh statement dengan 42P08 "inconsistent types deduced for parameter $1".
async function createPromptVersion({ key, locale, body, createdBy }) {
  const { rows } = await pool.query(
    `INSERT INTO assistant_prompts (key, locale, version, body, created_by)
     VALUES (
       $1::varchar, $2::varchar,
       COALESCE((SELECT max(version) FROM assistant_prompts WHERE key = $1::varchar AND locale = $2::varchar), 0) + 1,
       $3, $4
     )
     RETURNING *`,
    [key, locale, body, createdBy]
  );
  return rows[0];
}

// Satu transaksi: menonaktifkan yang lama dan mengaktifkan yang baru harus atomik, kalau tidak
// ux_assistant_prompts_active akan menolak di tengah jalan dan meninggalkan (key, locale)
// tanpa versi aktif sama sekali -- asisten mati total sampai ada yang menyadarinya.
async function activatePromptVersion(id) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT key, locale FROM assistant_prompts WHERE id = $1', [id]);
    if (!rows.length) {
      await client.query('ROLLBACK');
      return null;
    }
    const { key, locale } = rows[0];
    await client.query(
      'UPDATE assistant_prompts SET is_active = false WHERE key = $1 AND locale = $2 AND is_active',
      [key, locale]
    );
    const { rows: activated } = await client.query(
      'UPDATE assistant_prompts SET is_active = true WHERE id = $1 RETURNING *',
      [id]
    );
    await client.query('COMMIT');
    return activated[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ------------------------------------------------------------------- tools --

// Override saja -- tool tanpa baris di sini tetap aktif dengan permission dari kode registry
// (lihat komentar tabel di 0010_assistant.sql).
async function findToolOverrides(odooConnectionId) {
  const { rows } = await pool.query(
    `SELECT * FROM assistant_tools
     WHERE odoo_connection_id = $1 OR odoo_connection_id IS NULL
     ORDER BY (odoo_connection_id IS NULL)`,
    [odooConnectionId]
  );
  const byName = new Map();
  for (const row of rows) {
    // Baris per-connection lebih dulu (ORDER BY di atas), jadi yang global tidak menimpanya.
    if (!byName.has(row.tool_name)) byName.set(row.tool_name, row);
  }
  return byName;
}

async function listToolOverrides(odooConnectionId) {
  const { rows } = await pool.query(
    `SELECT * FROM assistant_tools
     WHERE ($1::uuid IS NULL AND odoo_connection_id IS NULL) OR odoo_connection_id = $1
     ORDER BY tool_name`,
    [odooConnectionId]
  );
  return rows;
}

// UPDATE-lalu-INSERT, bukan ON CONFLICT: UNIQUE (odoo_connection_id, tool_name) tidak menangkap
// apa pun saat odoo_connection_id NULL (di Postgres NULL tidak sama dengan NULL), jadi override
// global akan diam-diam terduplikasi setiap kali admin menyimpan, dan findToolOverrides akan
// memilih salah satunya sembarangan.
async function upsertToolOverride(odooConnectionId, { toolName, permissionCode, descriptionOverride, enabled }) {
  const { rows: updated } = await pool.query(
    `UPDATE assistant_tools
     SET permission_code = $3, description_override = $4, enabled = $5
     WHERE tool_name = $2 AND (($1::uuid IS NULL AND odoo_connection_id IS NULL) OR odoo_connection_id = $1)
     RETURNING *`,
    [odooConnectionId, toolName, permissionCode, descriptionOverride || null, enabled]
  );
  if (updated.length) return updated[0];

  const { rows } = await pool.query(
    `INSERT INTO assistant_tools (odoo_connection_id, tool_name, permission_code, description_override, enabled)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [odooConnectionId, toolName, permissionCode, descriptionOverride || null, enabled]
  );
  return rows[0];
}

module.exports = {
  findSettings,
  listSettings,
  upsertSettings,
  findProviderConfig,
  listProviderConfigs,
  upsertProviderConfig,
  recordProviderHealth,
  findActivePrompts,
  listPrompts,
  findPromptById,
  createPromptVersion,
  activatePromptVersion,
  findToolOverrides,
  listToolOverrides,
  upsertToolOverride,
};

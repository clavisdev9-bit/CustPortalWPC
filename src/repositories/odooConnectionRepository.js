const pool = require('../db/pool');
const ApiError = require('../utils/ApiError');

const UPDATABLE_FIELDS = new Set([
  'name',
  'url',
  'database',
  'username',
  'auth_type',
  'encrypted_credential',
  'odoo_version',
  'status',
  'last_checked_at',
  'last_error',
  'webhook_secret',
  // Migrasi 0015. Tidak ada di updateConnectionSchema, jadi PATCH /:id tidak bisa menyentuhnya --
  // satu-satunya penulisnya adalah odooConnectionService.setEnabled(), lewat route disable/enable
  // yang punya catatan audit sendiri.
  'is_enabled',
]);

async function list() {
  const { rows } = await pool.query('SELECT * FROM odoo_connections ORDER BY created_at DESC');
  return rows;
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM odoo_connections WHERE id = $1', [id]);
  return rows[0] || null;
}

// status/odoo_version/last_checked_at are insert-time arguments rather than post-insert updates
// because since CR-044 a row only ever reaches this function after Odoo has already accepted the
// credential -- a connection that exists but was never verified is no longer a reachable state,
// and writing 'pending' first would just be a lie the very next statement corrects.
async function create({
  name, url, database, username, authType, encryptedCredential, webhookSecret,
  status = 'pending', odooVersion = null, lastCheckedAt = null,
}) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO odoo_connections
         (name, url, database, username, auth_type, encrypted_credential, webhook_secret, status, odoo_version, last_checked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [name, url, database, username, authType, encryptedCredential, webhookSecret, status, odooVersion, lastCheckedAt]
    );
    return rows[0];
  } catch (err) {
    // ux_odoo_connections_target (0014). Pemeriksaan di odooConnectionService.create() menangkap
    // hampir semua kasus dengan pesan yang lebih baik, tapi ia membaca sebelum dua panggilan Odoo
    // yang lambat -- dobel-klik Simpan bisa lolos lewat jendela itu. Pola yang sama dengan
    // identityMappingRepository.create (BUG-01): constraint yang menang tetap harus muncul sebagai
    // konflik yang terbaca, bukan 500 mentah.
    if (err.code === '23505') {
      throw new ApiError(409, 'connection_already_exists', 'A connection to this Odoo, database and user already exists');
    }
    throw err;
  }
}

// BUG-30: dua baris yang menunjuk Odoo, database, dan user yang sama persis adalah duplikat, dan
// duplikat itulah yang membuat koneksi rusak bisa bertahan -- kredensial baru mendarat di baris
// BARU, sementara baris lama (beserta semua `identity_mappings` yang menempel padanya) tetap
// memegang kredensial basi. Perbandingannya menormalkan trailing slash dan kapitalisasi URL
// (".../" vs "..." adalah Odoo yang sama) serta username (login Odoo praktis selalu email), tapi
// TIDAK nama database -- di Postgres nama database memang case-sensitive.
async function findByTarget(url, database, username) {
  const { rows } = await pool.query(
    `SELECT * FROM odoo_connections
     WHERE lower(rtrim(url, '/')) = lower(rtrim($1, '/'))
       AND database = $2
       AND lower(username) = lower($3)
     LIMIT 1`,
    [url, database, username]
  );
  return rows[0] || null;
}

async function update(id, patch) {
  const fields = Object.keys(patch).filter((f) => UPDATABLE_FIELDS.has(f));
  if (!fields.length) return findById(id);
  const setClause = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
  const { rows } = await pool.query(
    `UPDATE odoo_connections SET ${setClause}, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, ...fields.map((f) => patch[f])]
  );
  return rows[0] || null;
}

async function remove(id) {
  await pool.query('DELETE FROM odoo_connections WHERE id = $1', [id]);
}

async function countIdentityMappings(id) {
  const { rows } = await pool.query('SELECT count(*)::int AS c FROM identity_mappings WHERE odoo_connection_id = $1', [id]);
  return rows[0].c;
}

module.exports = { list, findById, findByTarget, create, update, remove, countIdentityMappings };

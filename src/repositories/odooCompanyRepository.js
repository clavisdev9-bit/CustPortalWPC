const pool = require('../db/pool');

// `activeOdooCompanyIds` is the "Select Company" step of the setup flow (CR-044): the res.company
// ids the platform admin ticked. Every discovered company is still stored -- so the selection can
// be revisited later without re-entering the credential -- but only the ticked ones come back
// is_active. Passing null means "no selection was made here": new rows default to active and
// existing rows keep whatever they had, which is what the plain Sync Companies button wants
// (refresh names/currencies without silently re-activating a company an admin excluded).
async function upsertMany(connectionId, companies, activeOdooCompanyIds = null) {
  const selection = activeOdooCompanyIds ? new Set(activeOdooCompanyIds) : null;
  const rows = [];
  for (const company of companies) {
    // Cast is required: a plain null parameter leaves Postgres unable to infer COALESCE's type.
    const isActive = selection ? selection.has(company.id) : null;
    const { rows: r } = await pool.query(
      `INSERT INTO odoo_companies (odoo_connection_id, odoo_company_id, name, currency, is_active)
       VALUES ($1, $2, $3, $4, COALESCE($5::boolean, true))
       ON CONFLICT (odoo_connection_id, odoo_company_id)
       DO UPDATE SET name = EXCLUDED.name, currency = EXCLUDED.currency,
                     is_active = COALESCE($5::boolean, odoo_companies.is_active), updated_at = now()
       RETURNING *`,
      [connectionId, company.id, company.name, company.currency, isActive]
    );
    rows.push(r[0]);
  }
  return rows;
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM odoo_companies WHERE id = $1', [id]);
  return rows[0] || null;
}

// Backs the admin "Koneksi Odoo" settings page (Setting > Koneksi Odoo): shows which companies
// are already synced for a connection without re-hitting Odoo. Deliberately unfiltered by
// is_active -- this is the list the admin ticks boxes in, so it has to show the unticked ones too.
async function findByConnectionId(connectionId) {
  const { rows } = await pool.query(
    'SELECT * FROM odoo_companies WHERE odoo_connection_id = $1 ORDER BY name',
    [connectionId]
  );
  return rows;
}

// Includes the connection's own name so a multi-Odoo user's company switcher can group by
// which Odoo each company belongs to -- the data model has supported multiple connections per
// user since Phase 1 (identity_mappings is keyed per-connection); this just surfaces it in the read.
//
// Not filtered by is_active on purpose: a company an admin unticks later would otherwise vanish
// from the switcher of users already granted it, silently revoking access to data they can still
// see in Odoo. Deselection only governs what new provisioning may reach for (see below); taking
// access away stays an explicit portal_user_companies change.
// BUG-36/BUG-37: kesehatan koneksi ikut dibawa, dan sengaja TIDAK menyaring apa pun di sini.
// Satu-satunya pemakainya adalah tiebreak `issueSession` untuk user yang TIDAK punya
// `is_default` -- lihat komentar di sana. `companyService` membuang kedua kolom ini sebelum
// respons keluar ke klien; daftarnya sendiri tidak pernah dipangkas, karena menyembunyikan
// company milik user berarti menyembunyikan identitas Odoo-nya sendiri (BUG-37).
async function listForUser(userId) {
  const { rows } = await pool.query(
    `SELECT c.*, uc.is_default, conn.name AS connection_name,
            conn.is_enabled AS connection_enabled, conn.status AS connection_status
     FROM portal_user_companies uc
     JOIN odoo_companies c ON c.id = uc.odoo_company_id
     JOIN odoo_connections conn ON conn.id = c.odoo_connection_id
     WHERE uc.user_id = $1
     ORDER BY conn.name, c.name`,
    [userId]
  );
  return rows;
}

// BUG-25: resolves the portal-native UUID for a company a newly-provisioned user should default
// into, given the raw numeric res.company id Odoo reports on their res.users record. Returns null
// (never throws) when that company hasn't been synced locally yet (Sync Companies never run, or
// run after this user was provisioned) -- callers treat that as "can't default, leave unassigned"
// rather than blocking user creation on an unrelated admin step.
//
// CR-044: `is_active` is part of the lookup, so a company the platform admin deliberately left
// out of the "Select Company" step behaves exactly like one that was never synced -- provisioning
// falls into that same already-handled null branch instead of quietly seating a user in a company
// the portal was never configured to serve.
async function findByConnectionAndOdooCompanyId(connectionId, odooCompanyId) {
  const { rows } = await pool.query(
    'SELECT * FROM odoo_companies WHERE odoo_connection_id = $1 AND odoo_company_id = $2 AND is_active',
    [connectionId, odooCompanyId]
  );
  return rows[0] || null;
}

async function userHasAccess(userId, companyId) {
  const { rows } = await pool.query(
    'SELECT 1 FROM portal_user_companies WHERE user_id = $1 AND odoo_company_id = $2',
    [userId, companyId]
  );
  return rows.length > 0;
}

module.exports = {
  upsertMany,
  findById,
  findByConnectionId,
  findByConnectionAndOdooCompanyId,
  listForUser,
  userHasAccess,
};

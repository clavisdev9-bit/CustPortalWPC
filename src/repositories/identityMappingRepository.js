const pool = require('../db/pool');
const ApiError = require('../utils/ApiError');

async function create({ portalUserId, odooConnectionId, odooPartnerId }) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO identity_mappings (portal_user_id, odoo_connection_id, odoo_partner_id)
       VALUES ($1, $2, $3) RETURNING *`,
      [portalUserId, odooConnectionId, odooPartnerId]
    );
    return rows[0];
  } catch (err) {
    // unique_violation on (odoo_connection_id, odoo_partner_id) -- this Odoo contact already has
    // a portal identity; surface a clear conflict instead of the raw constraint error.
    if (err.code === '23505') {
      throw new ApiError(409, 'partner_already_linked', 'This Odoo contact is already linked to another portal user');
    }
    throw err;
  }
}

async function findByUser(portalUserId) {
  const { rows } = await pool.query('SELECT * FROM identity_mappings WHERE portal_user_id = $1', [portalUserId]);
  return rows;
}

// Used by webhook-driven provisioning (userService.provisionFromOdoo) to check idempotently,
// *before* creating anything, whether this exact Odoo contact already has a portal identity --
// cheaper and clearer than creating a portal_user speculatively and unwinding it on a unique
// constraint failure.
async function findByConnectionAndPartner(odooConnectionId, odooPartnerId) {
  const { rows } = await pool.query(
    'SELECT * FROM identity_mappings WHERE odoo_connection_id = $1 AND odoo_partner_id = $2',
    [odooConnectionId, odooPartnerId]
  );
  return rows[0] || null;
}

// Every portal user mapped to exactly this partner in this connection -- used to notify the right
// recipient(s) when a document is shared to them (document sharing, Option B). Per-individual: no
// commercial_partner_id family expansion, matching the exact-partner scoping of document_shares.
async function findUsersByPartner(odooConnectionId, odooPartnerId) {
  const { rows } = await pool.query(
    'SELECT portal_user_id FROM identity_mappings WHERE odoo_connection_id = $1 AND odoo_partner_id = $2',
    [odooConnectionId, odooPartnerId]
  );
  return rows;
}

module.exports = { create, findByUser, findByConnectionAndPartner, findUsersByPartner };

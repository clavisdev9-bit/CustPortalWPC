const pool = require('../db/pool');

async function create({ portalUserId, odooConnectionId, type, payload }) {
  const { rows } = await pool.query(
    `INSERT INTO customer_requests (portal_user_id, odoo_connection_id, type, payload)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [portalUserId, odooConnectionId, type, payload]
  );
  return rows[0];
}

// Scoped by odoo_connection_id too, not just portal_user_id -- a user can hold identity_mappings
// into more than one Odoo connection (see odooContext.js), and a row created under one connection
// must never be listed while a different connection's company is currently selected (same class of
// leak BUG-08 fixed for rma_requests/warranty_claims; see resolution.md BUG-13).
async function listForUser(userId, odooConnectionId) {
  const { rows } = await pool.query(
    'SELECT * FROM customer_requests WHERE portal_user_id = $1 AND odoo_connection_id = $2 ORDER BY created_at DESC',
    [userId, odooConnectionId]
  );
  return rows;
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM customer_requests WHERE id = $1', [id]);
  return rows[0] || null;
}

module.exports = { create, listForUser, findById };

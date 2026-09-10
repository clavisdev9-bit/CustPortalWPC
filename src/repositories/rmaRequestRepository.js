const pool = require('../db/pool');

async function create({ portalUserId, odooConnectionId, odooOrderId, odooTicketId, reason, requestedAction }) {
  const { rows } = await pool.query(
    `INSERT INTO rma_requests (portal_user_id, odoo_connection_id, odoo_order_id, odoo_ticket_id, reason, requested_action)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [portalUserId, odooConnectionId, odooOrderId || null, odooTicketId, reason, requestedAction]
  );
  return rows[0];
}

// Scoped by odoo_connection_id too, not just portal_user_id -- a user can hold identity_mappings
// into more than one Odoo connection (see odooContext.js), and a row from a different connection
// must never be listed under the one currently selected (its odoo_ticket_id belongs to a
// different Odoo database entirely).
async function listForUser(userId, odooConnectionId) {
  const { rows } = await pool.query(
    'SELECT * FROM rma_requests WHERE portal_user_id = $1 AND odoo_connection_id = $2 ORDER BY created_at DESC',
    [userId, odooConnectionId]
  );
  return rows;
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM rma_requests WHERE id = $1', [id]);
  return rows[0] || null;
}

module.exports = { create, listForUser, findById };

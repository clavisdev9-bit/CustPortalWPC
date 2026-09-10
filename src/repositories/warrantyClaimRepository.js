const pool = require('../db/pool');

async function create({ portalUserId, odooConnectionId, serialNumber, odooTicketId, issueDescription }) {
  const { rows } = await pool.query(
    `INSERT INTO warranty_claims (portal_user_id, odoo_connection_id, serial_number, odoo_ticket_id, issue_description)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [portalUserId, odooConnectionId, serialNumber, odooTicketId, issueDescription]
  );
  return rows[0];
}

// Scoped by odoo_connection_id too, not just portal_user_id -- see rmaRequestRepository.listForUser
// for why (a user's identity can span more than one Odoo connection).
async function listForUser(userId, odooConnectionId) {
  const { rows } = await pool.query(
    'SELECT * FROM warranty_claims WHERE portal_user_id = $1 AND odoo_connection_id = $2 ORDER BY created_at DESC',
    [userId, odooConnectionId]
  );
  return rows;
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM warranty_claims WHERE id = $1', [id]);
  return rows[0] || null;
}

module.exports = { create, listForUser, findById };

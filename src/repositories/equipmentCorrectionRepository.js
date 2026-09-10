const pool = require('../db/pool');

async function create({ portalUserId, odooConnectionId, odooEquipmentId, odooTicketId, correctionType, proposedValue, note }) {
  const { rows } = await pool.query(
    `INSERT INTO equipment_corrections
       (portal_user_id, odoo_connection_id, odoo_equipment_id, odoo_ticket_id, correction_type, proposed_value, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [portalUserId, odooConnectionId, odooEquipmentId, odooTicketId, correctionType, proposedValue, note || null]
  );
  return rows[0];
}

// Scoped by odoo_connection_id too, not just portal_user_id -- same rule as rma_requests: a row
// from a different connection's odoo_ticket_id belongs to a different Odoo database entirely.
async function listForUser(userId, odooConnectionId) {
  const { rows } = await pool.query(
    'SELECT * FROM equipment_corrections WHERE portal_user_id = $1 AND odoo_connection_id = $2 ORDER BY created_at DESC',
    [userId, odooConnectionId]
  );
  return rows;
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM equipment_corrections WHERE id = $1', [id]);
  return rows[0] || null;
}

module.exports = { create, listForUser, findById };

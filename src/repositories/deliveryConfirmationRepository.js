const pool = require('../db/pool');

async function create({ portalUserId, odooConnectionId, odooPickingId, notes, signatureFilePath }) {
  const { rows } = await pool.query(
    `INSERT INTO delivery_confirmations
       (portal_user_id, odoo_connection_id, odoo_picking_id, notes, signature_file_path)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [portalUserId, odooConnectionId, odooPickingId, notes || null, signatureFilePath || null]
  );
  return rows[0];
}

async function markSynced(id) {
  const { rows } = await pool.query(
    'UPDATE delivery_confirmations SET odoo_synced_at = now() WHERE id = $1 RETURNING *',
    [id]
  );
  return rows[0];
}

async function listForPicking(odooConnectionId, odooPickingId) {
  const { rows } = await pool.query(
    'SELECT * FROM delivery_confirmations WHERE odoo_connection_id = $1 AND odoo_picking_id = $2 ORDER BY created_at DESC',
    [odooConnectionId, odooPickingId]
  );
  return rows;
}

module.exports = { create, markSynced, listForPicking };

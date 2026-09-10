const pool = require('../db/pool');

async function create({ portalUserId, odooConnectionId, odooInvoiceId, filePath, originalFilename, mimeType, amount }) {
  const { rows } = await pool.query(
    `INSERT INTO payment_proofs
       (portal_user_id, odoo_connection_id, odoo_invoice_id, file_path, original_filename, mime_type, amount)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [portalUserId, odooConnectionId, odooInvoiceId, filePath, originalFilename, mimeType, amount || null]
  );
  return rows[0];
}

async function listForInvoice(odooConnectionId, odooInvoiceId) {
  const { rows } = await pool.query(
    'SELECT * FROM payment_proofs WHERE odoo_connection_id = $1 AND odoo_invoice_id = $2 ORDER BY created_at DESC',
    [odooConnectionId, odooInvoiceId]
  );
  return rows;
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM payment_proofs WHERE id = $1', [id]);
  return rows[0] || null;
}

module.exports = { create, listForInvoice, findById };

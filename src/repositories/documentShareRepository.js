const pool = require('../db/pool');

async function create({
  odooConnectionId,
  recipientPartnerId,
  odooAttachmentId,
  filename,
  mimetype,
  sizeBytes,
  category,
  note,
  sharedByUserId,
  expiresAt,
}) {
  const { rows } = await pool.query(
    `INSERT INTO document_shares
       (odoo_connection_id, recipient_partner_id, odoo_attachment_id,
        filename, mimetype, size_bytes, category, note, shared_by_user_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      odooConnectionId,
      recipientPartnerId,
      odooAttachmentId,
      filename,
      mimetype || null,
      sizeBytes || null,
      category || null,
      note || null,
      sharedByUserId || null,
      expiresAt || null,
    ]
  );
  return rows[0];
}

// The core no-leak query: a row is only ever returned to a session whose resolved partner (in the
// resolved connection) is *exactly* recipient_partner_id -- per-individual, no family expansion
// (same partner+connection scoping shape as customerRequestRepository.listForUser, BUG-13). Revoked
// or expired rows are filtered out here so both list and any future count share one definition.
async function listForRecipient(odooConnectionId, recipientPartnerId) {
  const { rows } = await pool.query(
    `SELECT id, filename, mimetype, size_bytes, category, note, created_at, expires_at
       FROM document_shares
      WHERE odoo_connection_id = $1
        AND recipient_partner_id = $2
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY created_at DESC`,
    [odooConnectionId, recipientPartnerId]
  );
  return rows;
}

// Sender's accountability list -- everything I've shared, including revoked/expired (so the sender
// can see the full history of what they sent, not just what's still live).
async function listBySender(sharedByUserId) {
  const { rows } = await pool.query(
    `SELECT id, odoo_connection_id, recipient_partner_id, filename, mimetype, size_bytes, category,
            note, created_at, expires_at, revoked_at
       FROM document_shares
      WHERE shared_by_user_id = $1
      ORDER BY created_at DESC`,
    [sharedByUserId]
  );
  return rows;
}

// Soft-revoke: only the original sharer can revoke, and only a still-live row -- returns the row on
// success or null (already revoked / not theirs / not found), which the service turns into a 404.
async function revoke(id, sharedByUserId) {
  const { rows } = await pool.query(
    `UPDATE document_shares SET revoked_at = now()
      WHERE id = $1 AND shared_by_user_id = $2 AND revoked_at IS NULL
      RETURNING id`,
    [id, sharedByUserId]
  );
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM document_shares WHERE id = $1', [id]);
  return rows[0] || null;
}

module.exports = { create, listForRecipient, listBySender, revoke, findById };

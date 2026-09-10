const pool = require('../db/pool');

async function create({ portalUserId, type, title, body, link }) {
  const { rows } = await pool.query(
    `INSERT INTO notifications (portal_user_id, type, title, body, link)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [portalUserId, type, title, body || null, link || null]
  );
  return rows[0];
}

async function list({ userId, page, pageSize, unreadOnly }) {
  const conditions = ['portal_user_id = $1'];
  const params = [userId];
  if (unreadOnly) conditions.push('read_at IS NULL');
  const where = `WHERE ${conditions.join(' AND ')}`;
  const listParams = [...params, pageSize, (page - 1) * pageSize];
  const { rows } = await pool.query(
    `SELECT * FROM notifications ${where} ORDER BY created_at DESC LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );
  const { rows: countRows } = await pool.query(`SELECT count(*)::int AS total FROM notifications ${where}`, params);
  const { rows: unreadRows } = await pool.query(
    'SELECT count(*)::int AS unread FROM notifications WHERE portal_user_id = $1 AND read_at IS NULL',
    [userId]
  );
  return { rows, total: countRows[0].total, unread: unreadRows[0].unread };
}

async function markRead(id, userId) {
  const { rows } = await pool.query(
    `UPDATE notifications SET read_at = now() WHERE id = $1 AND portal_user_id = $2 AND read_at IS NULL RETURNING *`,
    [id, userId]
  );
  return rows[0] || null;
}

async function markAllRead(userId) {
  await pool.query('UPDATE notifications SET read_at = now() WHERE portal_user_id = $1 AND read_at IS NULL', [userId]);
}

module.exports = { create, list, markRead, markAllRead };

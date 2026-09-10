const pool = require('../db/pool');

async function record({ actorUserId, action, targetType, targetId, metadata, ipAddress, userAgent }) {
  await pool.query(
    `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [actorUserId || null, action, targetType || null, targetId || null, metadata || null, ipAddress || null, userAgent || null]
  );
}

async function list({ page, pageSize, actorUserId, action, from, to }) {
  const conditions = [];
  const params = [];
  if (actorUserId) { params.push(actorUserId); conditions.push(`actor_user_id = $${params.length}`); }
  if (action) { params.push(action); conditions.push(`action = $${params.length}`); }
  if (from) { params.push(from); conditions.push(`created_at >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`created_at <= $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const listParams = [...params, pageSize, (page - 1) * pageSize];
  const { rows } = await pool.query(
    `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );
  const { rows: countRows } = await pool.query(`SELECT count(*)::int AS total FROM audit_logs ${where}`, params);
  return { rows, total: countRows[0].total };
}

module.exports = { record, list };

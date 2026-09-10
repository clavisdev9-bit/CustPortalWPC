const pool = require('../db/pool');

async function create({ portalUserId, tokenHash, expiresAt, ipAddress, userAgent }) {
  const { rows } = await pool.query(
    `INSERT INTO otp_tokens (portal_user_id, token_hash, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [portalUserId, tokenHash, expiresAt, ipAddress || null, userAgent || null]
  );
  return rows[0];
}

// Only one OTP is ever `pending` per user at a time in practice (supersedePending() runs before
// every insert), but LIMIT 1 + ORDER BY is defensive against that invariant ever slipping.
async function findLatestPending(portalUserId) {
  const { rows } = await pool.query(
    `SELECT * FROM otp_tokens WHERE portal_user_id = $1 AND status = 'pending'
     ORDER BY created_at DESC LIMIT 1`,
    [portalUserId]
  );
  return rows[0] || null;
}

async function findMostRecent(portalUserId) {
  const { rows } = await pool.query(
    `SELECT * FROM otp_tokens WHERE portal_user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [portalUserId]
  );
  return rows[0] || null;
}

async function supersedePending(portalUserId) {
  await pool.query(
    `UPDATE otp_tokens SET status = 'superseded' WHERE portal_user_id = $1 AND status = 'pending'`,
    [portalUserId]
  );
}

async function incrementAttempt(id) {
  const { rows } = await pool.query(
    `UPDATE otp_tokens SET attempt_count = attempt_count + 1 WHERE id = $1 RETURNING *`,
    [id]
  );
  return rows[0];
}

async function markVerified(id) {
  await pool.query(`UPDATE otp_tokens SET status = 'verified', verified_at = now() WHERE id = $1`, [id]);
}

async function markLocked(id) {
  await pool.query(`UPDATE otp_tokens SET status = 'locked' WHERE id = $1`, [id]);
}

async function countRecentRequests(portalUserId, since) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS total FROM otp_tokens WHERE portal_user_id = $1 AND created_at >= $2`,
    [portalUserId, since]
  );
  return rows[0].total;
}

module.exports = {
  create,
  findLatestPending,
  findMostRecent,
  supersedePending,
  incrementAttempt,
  markVerified,
  markLocked,
  countRecentRequests,
};

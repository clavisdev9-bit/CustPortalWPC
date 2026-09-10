const pool = require('../db/pool');

async function create({ userId, currentCompanyId, ipAddress, userAgent, expiresAt }) {
  const { rows } = await pool.query(
    `INSERT INTO sessions (user_id, current_company_id, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [userId, currentCompanyId, ipAddress, userAgent, expiresAt]
  );
  return rows[0];
}

async function findActiveById(id) {
  const { rows } = await pool.query(
    `SELECT * FROM sessions WHERE id = $1 AND status = 'active' AND expires_at > now()`,
    [id]
  );
  return rows[0] || null;
}

async function revoke(id) {
  await pool.query(`UPDATE sessions SET status = 'revoked', revoked_at = now() WHERE id = $1`, [id]);
}

async function updateCurrentCompany(id, companyId) {
  await pool.query('UPDATE sessions SET current_company_id = $2 WHERE id = $1', [id, companyId]);
}

module.exports = { create, findActiveById, revoke, updateCurrentCompany };

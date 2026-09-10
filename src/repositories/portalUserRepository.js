const pool = require('../db/pool');

const UPDATABLE_FIELDS = new Set([
  'name',
  'status',
  'password_hash',
  'two_factor_enabled',
  'two_factor_secret',
  'failed_login_attempts',
  'locked_until',
  'last_login_at',
]);

async function findByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM portal_users WHERE lower(email) = lower($1)', [email]);
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM portal_users WHERE id = $1', [id]);
  return rows[0] || null;
}

async function create({ email, name, passwordHash, status = 'active' }) {
  const { rows } = await pool.query(
    `INSERT INTO portal_users (email, name, password_hash, status)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [email, name, passwordHash, status]
  );
  return rows[0];
}

async function update(id, patch) {
  const fields = Object.keys(patch).filter((f) => UPDATABLE_FIELDS.has(f));
  if (!fields.length) return findById(id);
  const setClause = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
  const { rows } = await pool.query(
    `UPDATE portal_users SET ${setClause}, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, ...fields.map((f) => patch[f])]
  );
  return rows[0] || null;
}

// `scope` (from odooContext.resolveUserManagementScope) restricts results to portal users whose
// identity_mapping falls within the acting Customer Admin's own customer organization -- omitted
// entirely for a platform admin, who is allowed to see every customer.
async function list({ page, pageSize, status, scope }) {
  const conditions = [];
  const params = [];
  const joins = [];

  if (scope) {
    joins.push('JOIN identity_mappings im ON im.portal_user_id = pu.id');
    params.push(scope.odooConnectionId);
    conditions.push(`im.odoo_connection_id = $${params.length}`);
    params.push(scope.partnerIds);
    conditions.push(`im.odoo_partner_id = ANY($${params.length}::int[])`);
  }
  if (status) {
    params.push(status);
    conditions.push(`pu.status = $${params.length}`);
  }

  const joinClause = joins.join(' ');
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const listParams = [...params, pageSize, (page - 1) * pageSize];
  const { rows } = await pool.query(
    `SELECT DISTINCT pu.* FROM portal_users pu ${joinClause} ${where}
     ORDER BY pu.created_at DESC LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );
  const { rows: countRows } = await pool.query(
    `SELECT count(DISTINCT pu.id)::int AS total FROM portal_users pu ${joinClause} ${where}`,
    params
  );
  return { rows, total: countRows[0].total };
}

async function assignRoles(userId, roleIds) {
  await pool.query('DELETE FROM portal_user_roles WHERE user_id = $1', [userId]);
  if (!roleIds.length) return;
  const values = roleIds.map((_, i) => `($1, $${i + 2})`).join(', ');
  await pool.query(`INSERT INTO portal_user_roles (user_id, role_id) VALUES ${values}`, [userId, ...roleIds]);
}

async function getRoleNames(userId) {
  const { rows } = await pool.query(
    `SELECT r.name FROM portal_user_roles ur
     JOIN portal_roles r ON r.id = ur.role_id
     WHERE ur.user_id = $1`,
    [userId]
  );
  return rows.map((r) => r.name);
}

async function getPermissionCodes(userId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT p.code FROM portal_user_roles ur
     JOIN portal_role_permissions rp ON rp.role_id = ur.role_id
     JOIN portal_permissions p ON p.id = rp.permission_id
     WHERE ur.user_id = $1`,
    [userId]
  );
  return rows.map((r) => r.code);
}

async function recordFailedLogin(id, { lock, lockUntil }) {
  await pool.query(
    `UPDATE portal_users
     SET failed_login_attempts = failed_login_attempts + 1,
         locked_until = CASE WHEN $2 THEN $3 ELSE locked_until END
     WHERE id = $1`,
    [id, lock, lockUntil]
  );
}

async function resetLoginState(id) {
  await pool.query(
    `UPDATE portal_users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`,
    [id]
  );
}

module.exports = {
  findByEmail,
  findById,
  create,
  update,
  list,
  assignRoles,
  getRoleNames,
  getPermissionCodes,
  recordFailedLogin,
  resetLoginState,
};

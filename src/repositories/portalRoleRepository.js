const pool = require('../db/pool');

async function list() {
  const { rows } = await pool.query(`SELECT * FROM portal_roles WHERE status = 'active' ORDER BY name`);
  return rows;
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM portal_roles WHERE id = $1', [id]);
  return rows[0] || null;
}

async function findByIds(ids) {
  if (!ids.length) return [];
  const { rows } = await pool.query('SELECT * FROM portal_roles WHERE id = ANY($1::uuid[])', [ids]);
  return rows;
}

async function findByName(name) {
  const { rows } = await pool.query('SELECT * FROM portal_roles WHERE name = $1 AND status = $2', [name, 'active']);
  return rows[0] || null;
}

async function create({ name, description }) {
  const { rows } = await pool.query(
    'INSERT INTO portal_roles (name, description) VALUES ($1, $2) RETURNING *',
    [name, description || null]
  );
  return rows[0];
}

async function update(id, { description }) {
  const { rows } = await pool.query(
    'UPDATE portal_roles SET description = COALESCE($2, description), updated_at = now() WHERE id = $1 RETURNING *',
    [id, description]
  );
  return rows[0] || null;
}

async function remove(id) {
  await pool.query('DELETE FROM portal_roles WHERE id = $1', [id]);
}

async function setPermissions(roleId, permissionCodes) {
  await pool.query('DELETE FROM portal_role_permissions WHERE role_id = $1', [roleId]);
  if (!permissionCodes.length) return;
  await pool.query(
    `INSERT INTO portal_role_permissions (role_id, permission_id)
     SELECT $1, id FROM portal_permissions WHERE code = ANY($2::text[])`,
    [roleId, permissionCodes]
  );
}

async function getPermissions(roleId) {
  const { rows } = await pool.query(
    `SELECT p.code, p.name, p.module FROM portal_role_permissions rp
     JOIN portal_permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = $1`,
    [roleId]
  );
  return rows;
}

async function countUsers(roleId) {
  const { rows } = await pool.query('SELECT count(*)::int AS c FROM portal_user_roles WHERE role_id = $1', [roleId]);
  return rows[0].c;
}

module.exports = {
  list,
  findById,
  findByIds,
  findByName,
  create,
  update,
  remove,
  setPermissions,
  getPermissions,
  countUsers,
};

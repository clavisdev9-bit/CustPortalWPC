const pool = require('../db/pool');

async function list() {
  const { rows } = await pool.query('SELECT code, name, module FROM portal_permissions ORDER BY module, code');
  return rows;
}

module.exports = { list };

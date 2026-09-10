const { clientFor } = require('./OdooAuthService');

// Backs the "Get Companies" step in section 9 and POST /admin/odoo-connections/{id}/sync-companies.
async function list(connection, credential) {
  const client = clientFor(connection);
  const uid = await client.authenticate(connection.username, credential);
  return client.searchRead(uid, credential, 'res.company', [], ['id', 'name', 'currency_id']);
}

module.exports = { list };

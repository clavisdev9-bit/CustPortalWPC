const OdooClient = require('./OdooClient');

// Drives the "Check Connection" flow from section 9: version() then authenticate().
async function testConnection({ url, database, username, credential }) {
  const client = new OdooClient({ url, database });
  const versionInfo = await client.version();
  const uid = await client.authenticate(username, credential);
  return { version: versionInfo.server_version, uid };
}

// Step 1 of the CR-044 setup flow, before a database name is known: reach the server and ask
// which database(s) it serves. Split out of testConnection() because that one already needs a
// `database` to authenticate against, while the flow the admin follows (URL -> username ->
// credential -> Check Connection) never asks for one.
//
// `databases` is null when the server refuses to enumerate (list_db = False) -- that is a
// deliberate Odoo setting, not a failure, so the caller asks the admin to type the name instead.
// An unreachable host still throws here (version() does), which is what keeps "wrong URL" from
// being reported as "please tell me the database".
async function discover({ url }) {
  const client = new OdooClient({ url });
  const versionInfo = await client.version();
  return { version: versionInfo.server_version, databases: await client.listDatabases() };
}

function clientFor(connection) {
  return new OdooClient({ url: connection.url, database: connection.database });
}

// Authenticates once and returns a session bound to that uid/credential -- every Phase 2+
// service (sales, invoices, delivery, payment) opens one of these instead of repeating the
// authenticate-then-call boilerplate.
async function openSession(connection, credential) {
  const client = clientFor(connection);
  const uid = await client.authenticate(connection.username, credential);
  return {
    searchRead: (model, domain, fields, opts) => client.searchRead(uid, credential, model, domain, fields, opts),
    read: (model, ids, fields) => client.read(uid, credential, model, ids, fields),
    create: (model, values) => client.create(uid, credential, model, values),
    write: (model, ids, values) => client.write(uid, credential, model, ids, values),
    callMethod: (model, method, ids, args, kwargs) => client.callMethod(uid, credential, model, method, ids, args, kwargs),
    readGroup: (model, domain, fields, groupby, opts) =>
      client.readGroup(uid, credential, model, domain, fields, groupby, opts),
    // Separate web-session login under the hood (see OdooClient.fetchReportPdf) -- not part of
    // the uid/credential XML-RPC calls above.
    getReportPdf: (reportRef, ids) => client.fetchReportPdf(connection.username, credential, reportRef, ids),
  };
}

module.exports = { testConnection, discover, clientFor, openSession };

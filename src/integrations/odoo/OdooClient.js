const xmlrpc = require('xmlrpc');
const ApiError = require('../../utils/ApiError');

function createRpcClient(baseUrl, path) {
  const url = new URL(path, baseUrl);
  const options = {
    host: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname,
  };
  return url.protocol === 'https:' ? xmlrpc.createSecureClient(options) : xmlrpc.createClient(options);
}

function call(client, method, params) {
  return new Promise((resolve, reject) => {
    client.methodCall(method, params, (err, value) => {
      if (err) return reject(err);
      resolve(value);
    });
  });
}

// Thin wrapper around Odoo's XML-RPC External API (common + object endpoints).
// All model access goes through here so an Odoo upgrade only touches this file (section 34, risk #7).
class OdooClient {
  constructor({ url, database }) {
    this.url = url;
    this.database = database;
    this.common = createRpcClient(url, '/xmlrpc/2/common');
    this.object = createRpcClient(url, '/xmlrpc/2/object');
    this.db = createRpcClient(url, '/xmlrpc/2/db');
  }

  async version() {
    try {
      return await call(this.common, 'version', []);
    } catch (err) {
      throw new ApiError(422, 'odoo_unreachable', `Could not reach Odoo at ${this.url}: ${err.message}`);
    }
  }

  // The only call in this class that needs neither a database nor a credential -- it is what
  // makes the CR-044 flow able to ask for URL/username/password only: the database name is
  // discovered here instead of typed. Deployments with `list_db = False` (the Odoo.sh/SaaS
  // default) answer with an AccessDenied fault rather than a list; that is a deliberate server
  // setting, not a broken connection, so it resolves to null and the caller falls back to asking
  // for the name. Call version() first if you need to tell "unreachable" apart from "won't list".
  async listDatabases() {
    try {
      const names = await call(this.db, 'list', []);
      return Array.isArray(names) ? names : null;
    } catch {
      return null;
    }
  }

  async authenticate(username, credential) {
    let uid;
    try {
      uid = await call(this.common, 'authenticate', [this.database, username, credential, {}]);
    } catch (err) {
      throw new ApiError(422, 'odoo_unreachable', `Could not reach Odoo at ${this.url}: ${err.message}`);
    }
    if (!uid) {
      throw new ApiError(422, 'odoo_auth_failed', 'Odoo rejected the supplied credential');
    }
    return uid;
  }

  async execute(uid, credential, model, method, args = [], kwargs = {}) {
    try {
      return await call(this.object, 'execute_kw', [this.database, uid, credential, model, method, args, kwargs]);
    } catch (err) {
      throw new ApiError(502, 'odoo_call_failed', `Odoo ${model}.${method} failed: ${err.message}`);
    }
  }

  searchRead(uid, credential, model, domain = [], fields = [], opts = {}) {
    return this.execute(uid, credential, model, 'search_read', [domain], { fields, ...opts });
  }

  read(uid, credential, model, ids, fields = []) {
    return this.execute(uid, credential, model, 'read', [ids], { fields });
  }

  create(uid, credential, model, values) {
    return this.execute(uid, credential, model, 'create', [values]);
  }

  write(uid, credential, model, ids, values) {
    return this.execute(uid, credential, model, 'write', [ids, values]);
  }

  // Generic action/method call, e.g. action_confirm, copy, message_post -- all take
  // (ids, ...args) as Odoo's own convention for record methods.
  callMethod(uid, credential, model, method, ids, args = [], kwargs = {}) {
    return this.execute(uid, credential, model, method, [ids, ...args], kwargs);
  }

  // Server-side aggregation (e.g. groupby=['invoice_date:month']) -- confirmed live against a
  // real Odoo 18 instance that the grouped key comes back as a display label ("April 2026", not
  // an ISO date), the summed field keeps its plain name (no ":sum" suffix), and the count comes
  // back as `${groupbyField}_count`, not `__count`.
  readGroup(uid, credential, model, domain, fields, groupby, opts = {}) {
    return this.execute(uid, credential, model, 'read_group', [domain, fields, groupby], opts);
  }

  // Odoo's QWeb PDF rendering (ir.actions.report._render_qweb_pdf) is a private method -- calling
  // it through execute_kw fails with "Private methods ... cannot be called remotely" (confirmed
  // live against the target Odoo 18 instance). The only way to get the exact same PDF Odoo's own
  // web client/portal renders is its authenticated HTTP report route, which needs a web session
  // cookie rather than the uid/credential pair used by every other call in this class -- so this
  // logs in separately via /web/session/authenticate (JSON-RPC) rather than reusing execute_kw.
  async fetchReportPdf(username, credential, reportRef, ids) {
    let authRes;
    try {
      authRes = await fetch(new URL('/web/session/authenticate', this.url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'call',
          params: { db: this.database, login: username, password: credential },
        }),
      });
    } catch (err) {
      throw new ApiError(422, 'odoo_unreachable', `Could not reach Odoo at ${this.url}: ${err.message}`);
    }
    const authJson = await authRes.json().catch(() => null);
    const sessionCookie = authRes.headers.get('set-cookie')?.split(';')[0];
    if (!authJson?.result?.uid || !sessionCookie) {
      const message = authJson?.error?.data?.message || authJson?.error?.message || authRes.statusText;
      throw new ApiError(502, 'odoo_call_failed', `Odoo web session login failed: ${message}`);
    }

    const pdfRes = await fetch(new URL(`/report/pdf/${reportRef}/${ids.join(',')}`, this.url), {
      headers: { Cookie: sessionCookie },
    });
    if (!pdfRes.ok || !pdfRes.headers.get('content-type')?.startsWith('application/pdf')) {
      throw new ApiError(502, 'odoo_call_failed', `Odoo PDF report render failed: HTTP ${pdfRes.status}`);
    }
    return Buffer.from(await pdfRes.arrayBuffer());
  }
}

module.exports = OdooClient;

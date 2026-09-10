const asyncHandler = require('../utils/asyncHandler');
const odooConnectionService = require('../services/odooConnectionService');
const odooConnectionRateLimiter = require('../services/odooConnectionRateLimiter');
const auditService = require('../services/auditService');
const env = require('../config/env');
const {
  createConnectionSchema, updateConnectionSchema, checkConnectionSchema, syncCompaniesSchema,
} = require('../validators/odooConnectionValidators');

// encrypted_credential and webhook_secret must never leave this service on an ordinary read --
// the secret is only ever handed back once, from the two actions that just (re)generated it.
function toDto(connection) {
  const { encrypted_credential, encryption_key_version, webhook_secret, ...safe } = connection;
  return safe;
}

// BUG-23: req.protocol/req.get('host') alone is wrong whenever something between the browser and
// this process rewrites the Host header (Vite's dev proxy with changeOrigin: true does exactly
// that -- see env.publicApiBaseUrl's comment in config/env.js). Odoo calls this URL from a
// completely different machine, so a wrong host here isn't cosmetic -- the webhook silently never
// fires and looks identical to "Automation Rule not configured" from the portal's side.
function webhookUrl(req, connectionId, secret) {
  // Strip a trailing slash -- PUBLIC_API_BASE_URL=".../ " (a natural way to type a base URL) would
  // otherwise produce a double slash before "/api/v1/...", which Express/path-to-regexp never
  // collapses -- the route just never matches, reproducing BUG-23's "silent 404, looks identical
  // to Automation Rule not configured" symptom from the admin's side.
  const base = (env.publicApiBaseUrl || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  return `${base}/api/v1/webhooks/odoo/${connectionId}/${secret}`;
}

const list = asyncHandler(async (req, res) => {
  const rows = await odooConnectionService.list();
  res.json(rows.map(toDto));
});

// CR-044 "Check Connection": validates a credential the admin is still typing, against an Odoo
// that has no row here yet. The only endpoint in this group that persists nothing on the happy
// path -- which is exactly why it carries the burst limiter (see odooConnectionRateLimiter).
//
// A 200 is not the same as "credential OK": `status: 'database_required'` means the server was
// reached but nothing has been authenticated yet. The credential itself is never audited, only
// which Odoo was probed and how it went.
const checkConnection = asyncHandler(async (req, res) => {
  odooConnectionRateLimiter.checkBurst(req.user.id);
  const body = checkConnectionSchema.parse(req.body);
  const auditBase = {
    action: 'odoo_connection.check',
    targetType: 'odoo_connection',
    targetId: body.connection_id || null,
  };
  try {
    const result = await odooConnectionService.checkConnection({
      connectionId: body.connection_id,
      url: body.url,
      database: body.database,
      username: body.username,
      credential: body.credential,
    });
    await auditService.record(req, {
      ...auditBase,
      metadata: { url: body.url, username: body.username, status: result.status, version: result.odoo_version },
    });
    res.json(result);
  } catch (err) {
    await auditService.record(req, {
      ...auditBase,
      metadata: { url: body.url, username: body.username, status: 'error', message: err.message },
    });
    throw err;
  }
});

const create = asyncHandler(async (req, res) => {
  odooConnectionRateLimiter.checkBurst(req.user.id);
  const body = createConnectionSchema.parse(req.body);
  const { connection, companies } = await odooConnectionService.create({
    name: body.name,
    url: body.url,
    database: body.database,
    username: body.username,
    authType: body.auth_type,
    credential: body.credential,
    companyIds: body.company_ids,
  });
  await auditService.record(req, {
    action: 'odoo_connection.create',
    targetType: 'odoo_connection',
    targetId: connection.id,
    metadata: { companies: companies.filter((c) => c.is_active).map((c) => c.odoo_company_id) },
  });
  res.status(201).json({
    ...toDto(connection),
    companies,
    webhook_url: webhookUrl(req, connection.id, connection.webhook_secret),
  });
});

const get = asyncHandler(async (req, res) => res.json(toDto(await odooConnectionService.getOrThrow(req.params.id))));

// BUG-32: satu-satunya endpoint mutasi koneksi yang dulu tidak mencatat apa pun -- padahal ia
// yang paling merusak kalau salah. Ketika delapan pelanggan ternyata terikat ke database yang
// keliru, tidak ada satu baris audit pun yang bisa menjawab kapan `database` dipindah atau oleh
// siapa; rekonstruksinya harus lewat `odoo_connection.test` yang kebetulan gagal di sekitarnya.
// Nilai lama ikut dicatat karena "diubah jadi X" tanpa "dari Y" tidak cukup untuk memulihkan.
// `credential` hanya dicatat sebagai boolean -- aturan keamanan #4 di CLAUDE.md berlaku penuh
// untuk audit log, yang justru lebih sering dibaca ekspor-massal daripada tabel aslinya.
// Audit tidak boleh menggantikan error yang sedang dilaporkan: kalau INSERT-nya sendiri gagal
// (Postgres down, kolom jsonb menolak), melemparnya dari dalam catch akan menukar error Odoo yang
// informatif dengan 500 Postgres yang tidak ada hubungannya -- dan tetap kehilangan baris audit.
async function recordUpdate(req, auditBase, body, before, extra) {
  try {
    await auditService.record(req, { ...auditBase, metadata: { ...connectionUpdateMetadata(body, before), ...extra } });
  } catch (auditErr) {
    console.error('Failed to record odoo_connection.update audit entry:', auditErr.message);
  }
}

// Perubahan yang BENAR-BENAR tersimpan, dibaca dari baris sesudahnya. Hanya kolom non-rahasia.
function diffFields(before, after) {
  const changed = {};
  for (const field of ['name', 'url', 'database', 'username', 'auth_type']) {
    if (before[field] !== after[field]) changed[field] = { from: before[field], to: after[field] };
  }
  if (before.encrypted_credential !== after.encrypted_credential) changed.credential = true;
  return changed;
}

function connectionUpdateMetadata(body, before) {
  const changed = {};
  for (const field of ['name', 'url', 'database', 'username', 'auth_type']) {
    if (body[field] !== undefined && body[field] !== before[field]) {
      changed[field] = { from: before[field], to: body[field] };
    }
  }
  return {
    changed,
    credential_changed: body.credential !== undefined,
    company_ids: body.company_ids ?? null,
  };
}

const update = asyncHandler(async (req, res) => {
  odooConnectionRateLimiter.checkBurst(req.user.id);
  // Pass the parsed body through as-is: zod's .partial() only includes keys the client actually
  // sent, so an object literal re-listing every field here would reintroduce `undefined` for
  // the omitted ones -- which the repository would then write as NULL into NOT NULL columns.
  const body = updateConnectionSchema.parse(req.body);
  // Read before the write so the audit entry can carry the old values. A 404 here is the same
  // 404 the service would raise a moment later, so nothing is reordered semantically.
  const before = await odooConnectionService.getOrThrow(req.params.id);
  const auditBase = {
    action: 'odoo_connection.update',
    targetType: 'odoo_connection',
    targetId: req.params.id,
  };
  try {
    const connection = await odooConnectionService.update(req.params.id, body);
    await recordUpdate(req, auditBase, body, before, { result: 'applied' });
    res.json(toDto(connection));
  } catch (err) {
    // Percobaan yang DITOLAK justru yang paling ingin dilihat belakangan: 409
    // connection_target_locked adalah jejak bahwa seseorang mencoba memindahkan koneksi berisi
    // mapping, dan itu sinyal operasional (biasanya berarti koneksi baru menyusul).
    //
    // Tapi "gagal" tidak selalu berarti "tidak jadi apa-apa": update() menyimpan barisnya lalu
    // memanggil syncCompanies(), jadi kegagalan di langkah kedua meninggalkan baris yang SUDAH
    // berubah. Mencatatnya sebagai 'rejected' akan membuat audit log berbohong tentang satu-
    // satunya hal yang ia ada untuk menjawab. Jadi keadaan baris dibaca ulang dan yang dicatat
    // adalah apa yang benar-benar terjadi, bukan asumsi dari cabang mana kode ini berada.
    const after = await odooConnectionService.getOrThrow(req.params.id).catch(() => null);
    const applied = after ? diffFields(before, after) : {};
    await recordUpdate(req, auditBase, body, before, {
      result: Object.keys(applied).length > 0 ? 'partially_applied' : 'rejected',
      applied,
      code: err.code,
      message: err.message,
    });
    throw err;
  }
});

const remove = asyncHandler(async (req, res) => {
  await odooConnectionService.remove(req.params.id);
  res.status(204).end();
});

// Migrasi 0015. Route sendiri, bukan field di PATCH /:id, karena tiga alasan yang semuanya
// praktis: `updateConnectionSchema` mem-whitelist field dan menambahkan `is_enabled` ke sana akan
// membuat "mematikan koneksi" bisa menumpang pada request ganti nama; PATCH memakai jatah burst
// limiter Odoo padahal aksi ini tidak menelepon Odoo sama sekali; dan aksinya butuh entri audit
// dengan nama sendiri, bukan terkubur di dalam metadata `odoo_connection.update`.
//
// Mematikan koneksi memutus SEMUA pelanggan yang terpetakan padanya (503 di setiap endpoint), jadi
// jumlah mapping ikut dicatat -- itu ukuran dampak yang ingin dicari orang saat menelusuri
// "sejak kapan pelanggan ini tidak bisa melihat apa-apa".
function setEnabledHandler(isEnabled) {
  return asyncHandler(async (req, res) => {
    const connection = await odooConnectionService.setEnabled(req.params.id, isEnabled);
    await auditService.record(req, {
      action: isEnabled ? 'odoo_connection.enable' : 'odoo_connection.disable',
      targetType: 'odoo_connection',
      targetId: connection.id,
      metadata: {
        name: connection.name,
        url: connection.url,
        database: connection.database,
        mapped_users: await odooConnectionService.countIdentityMappings(connection.id),
      },
    });
    res.json(toDto(connection));
  });
}

const disable = setEnabledHandler(false);
const enable = setEnabledHandler(true);

const testConnection = asyncHandler(async (req, res) => {
  try {
    const result = await odooConnectionService.testConnection(req.params.id);
    await auditService.record(req, {
      action: 'odoo_connection.test',
      targetType: 'odoo_connection',
      targetId: req.params.id,
      metadata: { status: 'connected', version: result.version },
    });
    res.json({ status: 'connected', odoo_version: result.version });
  } catch (err) {
    await auditService.record(req, {
      action: 'odoo_connection.test',
      targetType: 'odoo_connection',
      targetId: req.params.id,
      metadata: { status: 'error', message: err.message },
    });
    throw err;
  }
});

const listCompanies = asyncHandler(async (req, res) => {
  res.json(await odooConnectionService.listCompanies(req.params.id));
});

// With `company_ids` this is the flow's "Select Company" step re-run against a connection that
// already exists; without one it is the plain refresh it has always been, and the existing
// selection is left alone.
const syncCompanies = asyncHandler(async (req, res) => {
  const body = syncCompaniesSchema.parse(req.body ?? {});
  const companies = await odooConnectionService.syncCompanies(req.params.id, body.company_ids ?? null);
  if (body.company_ids) {
    await auditService.record(req, {
      action: 'odoo_connection.select_companies',
      targetType: 'odoo_connection',
      targetId: req.params.id,
      metadata: { companies: body.company_ids },
    });
  }
  res.json(companies);
});

// BUG-24: bulk-imports every existing Odoo "Portal" (res.users share=true) contact as a
// portal_user, reusing the same provisionFromOdoo() the webhook uses -- safe to call repeatedly
// (already-provisioned/conflicting contacts come back with their status, not duplicated).
const syncUsers = asyncHandler(async (req, res) => {
  const results = await odooConnectionService.syncUsers(req.params.id);
  await auditService.record(req, {
    action: 'odoo_connection.sync_users',
    targetType: 'odoo_connection',
    targetId: req.params.id,
    metadata: {
      total: results.length,
      provisioned: results.filter((r) => r.status === 'provisioned').length,
      already_provisioned: results.filter((r) => r.status === 'already_provisioned').length,
      skipped_conflict: results.filter((r) => r.status === 'skipped_conflict').length,
      skipped_invalid_email: results.filter((r) => r.status === 'skipped_invalid_email').length,
    },
  });
  res.json(results);
});

// Returns the new raw secret + ready-to-paste webhook URL exactly once -- rotate again (which
// immediately invalidates the old one) if it's ever lost or leaked.
const rotateWebhookSecret = asyncHandler(async (req, res) => {
  const secret = await odooConnectionService.rotateWebhookSecret(req.params.id);
  await auditService.record(req, {
    action: 'odoo_connection.webhook_secret_rotate',
    targetType: 'odoo_connection',
    targetId: req.params.id,
  });
  res.json({ webhook_url: webhookUrl(req, req.params.id, secret) });
});

module.exports = {
  list, checkConnection, create, get, update, remove,
  testConnection, listCompanies, syncCompanies, syncUsers, rotateWebhookSecret,
  disable, enable,
};

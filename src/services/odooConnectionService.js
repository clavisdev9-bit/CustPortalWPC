const { z } = require('zod');
const odooConnectionRepository = require('../repositories/odooConnectionRepository');
const odooCompanyRepository = require('../repositories/odooCompanyRepository');
const OdooAuthService = require('../integrations/odoo/OdooAuthService');
const OdooCompanyService = require('../integrations/odoo/OdooCompanyService');
const OdooPartnerService = require('../integrations/odoo/OdooPartnerService');
const userService = require('./userService');
const odooCapabilityService = require('./odooCapabilityService');
const crypto = require('../utils/crypto');
const ApiError = require('../utils/ApiError');

async function getOrThrow(id) {
  const connection = await odooConnectionRepository.findById(id);
  if (!connection) throw new ApiError(404, 'not_found', 'Odoo connection not found');
  return connection;
}

// res.company comes back with currency_id as Odoo's many2one tuple [id, name]; every consumer
// (odoo_companies.currency, the wizard's company picker) wants the label only.
function toCompanyChoice(company) {
  return {
    id: company.id,
    name: company.name,
    currency: Array.isArray(company.currency_id) ? company.currency_id[1] : null,
  };
}

// CR-044 step "Validate Odoo Credential" -- the whole point is that it runs BEFORE anything is
// persisted, so a connection row can never exist in a state nobody has ever proven works.
//
// Three outcomes, and they are deliberately not all errors:
//   - throws 422 odoo_unreachable / odoo_auth_failed  -> the flow's "Credential OK? NO" branch
//   - { status: 'database_required' }                 -> reachable, but the database name could
//     not be determined on its own (Odoo refuses to list, or serves several); the admin is asked
//     for that one field and checks again. Not a failure -- nothing is wrong with the credential
//     yet, it simply has not been testable.
//   - { status: 'connected', ..., companies }         -> the "YES" branch, with the company list
//     the next step selects from already in hand (one round trip instead of save-then-sync).
//
// `connectionId` is for re-checking a connection that already exists (the edit form): the stored
// credential is used when none is typed, and the outcome is written back to
// status/last_checked_at/last_error so the row never contradicts what the admin was just shown.
async function checkConnection({ connectionId, url, database, username, credential }) {
  let existing = null;
  let effectiveCredential = credential;
  if (connectionId) {
    existing = await getOrThrow(connectionId);
    if (!effectiveCredential) effectiveCredential = crypto.decrypt(existing.encrypted_credential);
  }

  try {
    const { version, databases } = await OdooAuthService.discover({ url });
    // A single database is the overwhelmingly common case and the reason this flow can get away
    // with asking for three fields; anything else has to be disambiguated by a human.
    const resolvedDatabase = database || (databases && databases.length === 1 ? databases[0] : null);
    if (!resolvedDatabase) {
      return { status: 'database_required', odoo_version: version, database: null, databases, companies: [] };
    }

    await OdooAuthService.testConnection({ url, database: resolvedDatabase, username, credential: effectiveCredential });
    const companies = await OdooCompanyService.list({ url, database: resolvedDatabase, username }, effectiveCredential);

    if (existing) {
      await odooConnectionRepository.update(connectionId, {
        status: 'connected',
        odoo_version: version,
        last_checked_at: new Date(),
        last_error: null,
      });
    }
    return {
      status: 'connected',
      odoo_version: version,
      database: resolvedDatabase,
      databases,
      companies: companies.map(toCompanyChoice),
    };
  } catch (err) {
    if (existing) {
      await odooConnectionRepository.update(connectionId, {
        status: 'error',
        last_checked_at: new Date(),
        last_error: err.message,
      });
    }
    throw err;
  }
}

// "Save Configuration", the last step of the flow -- and the only way a row is created. Odoo is
// contacted again here rather than trusting the client's earlier successful check: the API is a
// contract of its own, and this is what makes "every stored connection was verified at the moment
// it was stored" true regardless of which client wrote it. Both Odoo calls happen before the
// INSERT, so a failure anywhere leaves no half-configured row behind.
async function create({ name, url, database, username, authType, credential, companyIds }) {
  // BUG-30: menolak baris kedua untuk Odoo+database+user yang sama. Duplikat terlihat tidak
  // berbahaya -- keduanya toh tervalidasi saat disimpan -- tapi ia memecah pelanggan ke dua baris
  // yang berbeda nasib: `identity_mappings` menempel pada satu baris tertentu, jadi memperbaiki
  // kredensial di baris yang satu tidak menolong siapa pun yang terpetakan ke baris yang lain.
  // Persis begitu koneksi rusak bisa bertahan berhari-hari sambil "sudah diperbaiki".
  const duplicate = await odooConnectionRepository.findByTarget(url, database, username);
  if (duplicate) {
    throw new ApiError(
      409,
      'connection_already_exists',
      `Koneksi "${duplicate.name}" sudah menunjuk Odoo, database, dan user yang sama. `
      + 'Perbarui koneksi itu (Edit) alih-alih membuat yang baru.'
    );
  }

  const probe = await OdooAuthService.testConnection({ url, database, username, credential });
  const companies = await OdooCompanyService.list({ url, database, username }, credential);

  const connection = await odooConnectionRepository.create({
    name,
    url,
    database,
    username,
    authType,
    encryptedCredential: crypto.encrypt(credential),
    webhookSecret: crypto.randomToken(24),
    status: 'connected',
    odooVersion: probe.version,
    lastCheckedAt: new Date(),
  });
  const stored = await odooCompanyRepository.upsertMany(
    connection.id,
    companies.map(toCompanyChoice),
    companyIds ?? null
  );
  return { connection, companies: stored };
}

// Migrasi 0015. Menghentikan pemakaian sebuah koneksi tanpa menghapusnya -- sebelum ini
// satu-satunya cara adalah `remove()`, yang menolak selama koneksi itu masih punya user
// terpetakan, jadi koneksi yang paling perlu dihentikan justru tidak bisa dihentikan.
//
// Tiga hal yang sengaja TIDAK dilakukan di sini:
//
//   * Tidak menelepon Odoo. Menyalakan kembali bukan pernyataan "kredensialnya sekarang benar" --
//     itu urusan Test Connection dan health recorder, yang menulis kolom lain. Kalau enable ikut
//     memvalidasi, koneksi yang Odoo-nya sedang mati tidak bisa dinyalakan lagi, dan pemulihannya
//     jadi bergantung pada urutan yang tidak dikendalikan admin.
//   * Tidak diblokir oleh identity_mappings, tidak seperti `remove()`. Justru koneksi yang punya
//     pelanggan terpetakan itulah alasan fungsi ini ada.
//   * Tidak menyentuh `status`. Baris yang dimatikan tetap boleh dan tetap berguna untuk diuji;
//     lihat komentar migrasi 0015 soal kenapa ini kolom terpisah dan bukan status='disabled'.
async function setEnabled(id, isEnabled) {
  await getOrThrow(id);
  return odooConnectionRepository.update(id, { is_enabled: isEnabled });
}

// Untuk aksi admin yang MENGUBAH data portal memakai koneksi ini (sync company, sync user), bukan
// yang sekadar memeriksanya. Test Connection sengaja tidak lewat sini -- lihat setEnabled().
function assertEnabled(connection) {
  if (connection.is_enabled === false) {
    throw new ApiError(
      409,
      'connection_disabled',
      `Koneksi "${connection.name}" sedang dinonaktifkan. Aktifkan dulu sebelum menyinkronkan data darinya.`
    );
  }
}

// Returns the raw secret exactly once -- same "shown once" precedent as userService.create's
// activation_token. Only the sha256 digest is meant to be compared against on receipt, but the
// column stores it in the clear (like encrypted_credential's plaintext counterpart) since the
// admin may need to re-paste it into Odoo's webhook action config, which has no secret-manager
// integration of its own.
async function rotateWebhookSecret(id) {
  await getOrThrow(id);
  const webhookSecret = crypto.randomToken(24);
  await odooConnectionRepository.update(id, { webhook_secret: webhookSecret });
  return webhookSecret;
}

// Fields that change what the portal talks to, as opposed to how it is labelled locally.
const ODOO_FACING_FIELDS = ['url', 'database', 'username', 'credential'];

// BUG-32. Sub-himpunan dari ODOO_FACING_FIELDS yang menentukan *ruang id*, bukan sekadar *siapa
// yang membaca*: id numerik Odoo (`res.partner.id`, `res.company.id`) hanya bermakna di dalam satu
// database. `identity_mappings.odoo_partner_id = 8` berarti "AYU SENTOSA SEJAHTERA, PT" di
// `pt_dira_staging` dan "ANUGRAH TEKNIK WISESA, PT" di `pt_dira` -- dua pelanggan yang tidak ada
// hubungannya.
//
// `username`/`credential` SENGAJA tidak ada di sini. Keduanya mengganti siapa yang login, bukan
// database yang dibaca, jadi id-nya tetap menunjuk record yang sama -- dan memblokirnya akan
// mengulang jebakan BUG-30: admin yang user integrasinya diganti tidak bisa lagi memperbaiki
// barisnya, sehingga ia membuat baris baru dan meninggalkan semua mapping lama di baris rusak.
const ID_SPACE_FIELDS = ['url', 'database'];

async function update(id, patch) {
  const existing = await getOrThrow(id);
  const dbPatch = { ...patch };
  if (patch.credential) {
    dbPatch.encrypted_credential = crypto.encrypt(patch.credential);
    delete dbPatch.credential;
  }
  // Not a column; carried on the same body so "save the edited connection" and "save the company
  // selection" stay one admin action. The repository would drop it anyway -- silently.
  const companyIds = dbPatch.company_ids;
  delete dbPatch.company_ids;

  // Same rule as create: an edit that repoints the connection at a different Odoo, database, user
  // or credential is verified before it is written. A rename or a company re-selection touches
  // nothing Odoo cares about, so it must not be blocked by an Odoo that happens to be down.
  if (ODOO_FACING_FIELDS.some((field) => patch[field] !== undefined)) {
    const url = patch.url ?? existing.url;
    const database = patch.database ?? existing.database;
    const username = patch.username ?? existing.username;

    // Guard duplikat yang sama seperti create(), tapi HANYA saat targetnya benar-benar dipindah.
    // Memeriksanya pada setiap edit Odoo-facing akan salah arah: baris duplikat yang terlanjur ada
    // (persis kondisi yang melahirkan BUG-30) justru jadi tidak bisa diperbaiki kredensialnya --
    // memblokir satu-satunya tindakan yang menyembuhkannya.
    // BUG-32: memindahkan url/database pada koneksi yang SUDAH punya identity_mappings tidak
    // mengubah "koneksi ini menunjuk ke mana" saja -- ia mengikat ulang setiap pelanggan yang
    // terpetakan padanya ke record mana pun yang kebetulan memegang id yang sama di database
    // baru. Kegagalannya diam: tidak ada error, tidak ada baris yang hilang, hanya pelanggan yang
    // tiba-tiba melihat daftar kosong (kasus terbaik) atau data pelanggan lain (kasus terburuk).
    //
    // Ditolak, bukan diperingatkan, dan bukan "dipetakan ulang otomatis": tidak ada pemetaan yang
    // benar untuk ditebak. Satu-satunya pihak yang tahu partner mana di database baru yang sama
    // dengan partner lama adalah manusia yang memutuskan pemindahan itu, jadi jalur yang benar
    // adalah koneksi baru + mapping baru, dengan koneksi lama dihapus setelah kosong (`remove()`
    // sudah menolak selama masih ada mapping). Guard ini duduk SEBELUM panggilan Odoo yang lambat
    // supaya penolakannya seketika.
    // Normalisasinya WAJIB sama dengan findByTarget() dan index di migrasi 0014: di sana
    // "https://x/" dan "https://x" sudah dinyatakan sebagai Odoo yang sama. Membandingkan mentah
    // di sini akan menolak penambahan trailing slash sebagai "pemindahan database" -- 409 untuk
    // suntingan yang tidak memindahkan apa pun. Nama database tetap case-sensitive (Postgres).
    const sameTarget = {
      url: (a, b) => a.replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase(),
      database: (a, b) => a === b,
    };
    const idSpaceMoved = ID_SPACE_FIELDS.some(
      (field) => patch[field] !== undefined && !sameTarget[field](patch[field], existing[field])
    );
    if (idSpaceMoved) {
      const mapped = await odooConnectionRepository.countIdentityMappings(id);
      if (mapped > 0) {
        throw new ApiError(
          409,
          'connection_target_locked',
          `Koneksi ini sudah dipakai ${mapped} identitas pelanggan, jadi Odoo/database tujuannya tidak bisa dipindah. `
          + 'Id partner dan company hanya berlaku di satu database -- memindahkannya akan menautkan '
          + 'pelanggan yang ada ke record pelanggan lain. Buat koneksi baru untuk database tujuan, '
          + 'petakan ulang usernya, lalu hapus koneksi ini.'
        );
      }
    }

    const targetMoved = url !== existing.url || database !== existing.database || username !== existing.username;
    if (targetMoved) {
      const duplicate = await odooConnectionRepository.findByTarget(url, database, username);
      if (duplicate && duplicate.id !== id) {
        throw new ApiError(
          409,
          'connection_already_exists',
          `Koneksi "${duplicate.name}" sudah menunjuk Odoo, database, dan user yang sama.`
        );
      }
    }

    const probe = await OdooAuthService.testConnection({
      url,
      database,
      username,
      credential: patch.credential ?? crypto.decrypt(existing.encrypted_credential),
    });
    dbPatch.status = 'connected';
    dbPatch.odoo_version = probe.version;
    dbPatch.last_checked_at = new Date();
    dbPatch.last_error = null;
  }

  const connection = await odooConnectionRepository.update(id, dbPatch);
  // Kapabilitas di-cache per koneksi selama 10 menit (CR-046). Kalau baris ini baru saja berpindah
  // Odoo/database -- atau berganti kredensial ke user dengan hak baca berbeda -- cache itu
  // menjelaskan Odoo yang sudah bukan tujuannya lagi, dan justru mengembalikan fault XML-RPC
  // mentah yang BUG-31 hilangkan. Dibuang di sini, satu-satunya tempat target sebuah koneksi
  // bisa berubah.
  if (ODOO_FACING_FIELDS.some((field) => patch[field] !== undefined)) {
    odooCapabilityService.invalidate(id);
  }
  if (companyIds) await syncCompanies(id, companyIds);
  return connection;
}

// Drives the "CHECK CONNECTION" button in section 9: calls Odoo for real and records the
// outcome (including failures) so /admin/odoo-connections/{id} always reflects the last attempt.
async function testConnection(id) {
  const connection = await getOrThrow(id);
  const credential = crypto.decrypt(connection.encrypted_credential);
  try {
    const result = await OdooAuthService.testConnection({
      url: connection.url,
      database: connection.database,
      username: connection.username,
      credential,
    });
    await odooConnectionRepository.update(id, {
      status: 'connected',
      odoo_version: result.version,
      last_checked_at: new Date(),
      last_error: null,
    });
    return result;
  } catch (err) {
    await odooConnectionRepository.update(id, {
      status: 'error',
      last_checked_at: new Date(),
      last_error: err.message,
    });
    throw err;
  }
}

async function listCompanies(id) {
  await getOrThrow(id);
  return odooCompanyRepository.findByConnectionId(id);
}

// `companyIds` re-runs the flow's "Select Company" step against an existing connection. Null
// (the plain Sync Companies button) refreshes the list without touching the current selection.
async function syncCompanies(id, companyIds = null) {
  const connection = await getOrThrow(id);
  assertEnabled(connection);
  const credential = crypto.decrypt(connection.encrypted_credential);
  const companies = await OdooCompanyService.list(connection, credential);
  return odooCompanyRepository.upsertMany(id, companies.map(toCompanyChoice), companyIds);
}

// BUG-24: the only paths that ever populated portal_users were POST /users (manual, one at a
// time) and the Odoo webhook (event-driven, only fires for a "Portal Access" grant made AFTER the
// Automation Rule existed) -- there was never a bulk path for contacts that already had Portal
// access before the connection was even configured. Reuses userService.provisionFromOdoo (the
// exact same idempotent create-or-skip logic the webhook already uses) so a contact synced here
// and later re-triggered by the webhook (or synced again) can never double-provision.
async function syncUsers(id) {
  const connection = await getOrThrow(id);
  // Menonaktifkan koneksi lalu mengimpor 200 user darinya adalah dua perintah yang saling
  // membatalkan; yang kedua hanya membuat akun yang semuanya 503 begitu dipakai.
  assertEnabled(connection);
  const credential = crypto.decrypt(connection.encrypted_credential);
  const odooUsers = await OdooPartnerService.listPortalUsers(connection, credential);

  const results = [];
  for (const odooUser of odooUsers) {
    const partnerId = Array.isArray(odooUser.partner_id) ? odooUser.partner_id[0] : odooUser.partner_id;
    const email = odooUser.email || odooUser.login;
    // The webhook path (userProvisionedWebhookSchema) only ever accepts login/email that already
    // look like an email address -- `login` can be a bare username in Odoo, and provisioning one
    // as-is would create a portal_user that can never receive its activation email nor log in via
    // the email-based flow (bricked, but silently -- found via /code-review, not live data here).
    if (!z.string().email().safeParse(email).success) {
      results.push({ odoo_partner_id: partnerId, email, name: odooUser.name, status: 'skipped_invalid_email', user_id: null });
      continue;
    }
    const { status, user } = await userService.provisionFromOdoo({
      odooConnectionId: id,
      odooPartnerId: partnerId,
      email,
      name: odooUser.name,
      odooCompanyId: odooUser.company_id,
    });
    results.push({ odoo_partner_id: partnerId, email, name: odooUser.name, status, user_id: user.id });
  }
  return results;
}

async function remove(id) {
  const mapped = await odooConnectionRepository.countIdentityMappings(id);
  if (mapped > 0) throw new ApiError(409, 'connection_in_use', 'Connection still has mapped users');
  await odooConnectionRepository.remove(id);
}

module.exports = {
  list: odooConnectionRepository.list,
  getOrThrow,
  checkConnection,
  create,
  update,
  testConnection,
  listCompanies,
  syncCompanies,
  syncUsers,
  rotateWebhookSecret,
  setEnabled,
  // Dipakai controller untuk mencatat dampak disable/enable di audit log. Diteruskan apa adanya,
  // pola yang sama dengan `list` di atas -- controller tidak memanggil repository sendiri.
  countIdentityMappings: odooConnectionRepository.countIdentityMappings,
  remove,
};

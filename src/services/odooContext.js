const odooCompanyRepository = require('../repositories/odooCompanyRepository');
const odooConnectionRepository = require('../repositories/odooConnectionRepository');
const identityMappingRepository = require('../repositories/identityMappingRepository');
const OdooAuthService = require('../integrations/odoo/OdooAuthService');
const OdooPartnerService = require('../integrations/odoo/OdooPartnerService');
const odooConnectionHealth = require('./odooConnectionHealth');
const odooCapabilityService = require('./odooCapabilityService');
const crypto = require('../utils/crypto');
const ApiError = require('../utils/ApiError');

// Dua kode ini berarti "koneksi Odoo-nya sendiri yang bermasalah", bukan "permintaan ini salah":
// kredensial ditolak, atau servernya tidak terjangkau. Keduanya lahir di OdooClient.authenticate.
const CONNECTION_ERROR_CODES = new Set(['odoo_auth_failed', 'odoo_unreachable']);

// BUG-30. Dua hal sekaligus, dan keduanya soal siapa yang membaca pesannya.
//
// 1. Hasilnya dicatat ke baris koneksi (odooConnectionHealth), supaya permintaan pelanggan
//    sungguhan ikut berfungsi sebagai health check. Tanpa ini `status` hanya berubah kalau ada
//    admin yang kebetulan menekan Test Connection -- dan koneksi yang kredensialnya basi bisa
//    berbulan-bulan tampil hijau di halaman admin sementara semua pelanggannya terkunci total.
//
// 2. Errornya diterjemahkan. "Odoo rejected the supplied credential" adalah kalimat yang benar
//    untuk admin yang baru mengetik kredensial di form koneksi -- dan itulah konteks aslinya,
//    endpoint check-connection/test-connection, yang SENGAJA tetap memakai 422 mentah itu. Tapi
//    di /invoices milik pelanggan, kalimat itu membocorkan detail internal ke orang yang tidak
//    bisa berbuat apa-apa dengannya. 503 juga lebih jujur secara semantik: bukan permintaannya
//    yang salah (4xx), melainkan dependensi hulu yang sedang tidak bisa dilayani.
async function openSessionOrRecord(connection, open) {
  try {
    const result = await open();
    await odooConnectionHealth.recordSuccess(connection);
    return result;
  } catch (err) {
    if (!(err instanceof ApiError) || !CONNECTION_ERROR_CODES.has(err.code)) throw err;
    await odooConnectionHealth.recordFailure(connection, err.message);
    throw new ApiError(
      503,
      'odoo_connection_unavailable',
      'Koneksi ke Odoo untuk perusahaan ini sedang bermasalah. Hubungi administrator portal.'
    );
  }
}

// Migrasi 0015 / CR-047. Gerbang "koneksi ini sengaja dimatikan admin": satu keadaan, satu
// kalimat, dengan alasan penempatan yang sama seperti gerbang `feature` di bawah -- choke point
// tidak bisa lupa dipasang.
//
// 503, bukan 403: permintaannya sah dan hak aksesnya benar, dependensi hulunya yang sedang tidak
// dilayani. Bentuknya sengaja sama persis dengan `odoo_connection_unavailable` di
// openSessionOrRecord -- dari sisi pelanggan keduanya adalah keadaan yang sama ("portal tidak
// bisa mengambil data ini sekarang, dan bukan Anda yang bisa memperbaikinya"), dan membedakannya
// hanya membocorkan keputusan internal administrator portal.
//
// BUG-36: diekspor karena resolveIdentity bukan lagi satu-satunya yang perlu menjawabnya.
// companyService memakainya untuk menolak perpindahan company SEBELUM sesi terlanjur duduk di
// koneksi mati. Satu fungsi, bukan dua literal string yang harus diingat supaya tetap sama.
function assertConnectionEnabled(connection) {
  if (connection.is_enabled === false) {
    throw new ApiError(
      503,
      'odoo_connection_disabled',
      'Koneksi ke Odoo untuk perusahaan ini sedang dinonaktifkan. Hubungi administrator portal.'
    );
  }
}

// Turns "the logged-in portal user, in their currently selected company" into the
// connection/partner/company triple used to scope every domain filter, without yet making any
// network call to Odoo -- callers that only need to know *which* Odoo/partner this is (e.g.
// stamping a portal-only record with odoo_connection_id) use this directly.
async function resolveIdentity(userId, currentCompanyId) {
  if (!currentCompanyId) {
    throw new ApiError(400, 'no_company_selected', 'Select a company first (POST /companies/switch)');
  }

  const company = await odooCompanyRepository.findById(currentCompanyId);
  if (!company) throw new ApiError(404, 'not_found', 'Company not found');

  const connection = await odooConnectionRepository.findById(company.odoo_connection_id);
  if (!connection) throw new ApiError(404, 'not_found', 'Odoo connection for this company no longer exists');

  // Diperiksa SEBELUM identity mapping: kalau koneksinya memang dimatikan, "tidak ada mapping"
  // bukan jawaban yang benar untuk ditunjukkan ke siapa pun yang membaca log.
  assertConnectionEnabled(connection);

  const mappings = await identityMappingRepository.findByUser(userId);
  const mapping = mappings.find((m) => m.odoo_connection_id === connection.id);
  if (!mapping) {
    throw new ApiError(403, 'no_identity_mapping', 'No Odoo identity mapped for this company\'s connection');
  }

  return {
    connection,
    odooPartnerId: mapping.odoo_partner_id,
    odooCompanyId: company.odoo_company_id,
  };
}

// Every Phase 2+ read/action that actually talks to Odoo goes through this: it additionally
// authenticates and returns a live session, so "my invoices" is structurally scoped to the
// resolved partner_id/company_id (section 22) rather than trusting anything the client sent.
//
// BUG-31: `options.feature` menolak lebih awal kalau modul Odoo yang menopang fitur itu tidak
// terpasang (`odooCapabilityService`). Gerbangnya diletakkan DI SINI, bukan sebagai satu baris
// tambahan di ~20 fungsi service, karena alasan yang sama seperti penguncian partner_id: yang
// dipasang di choke point tidak bisa lupa dipasang. Service yang menyentuh model Odoo opsional
// hanya perlu menyebut nama fiturnya saat mengambil sesi.
async function resolveOdooContext(userId, currentCompanyId, options = {}) {
  const identity = await resolveIdentity(userId, currentCompanyId);
  const credential = crypto.decrypt(identity.connection.encrypted_credential);
  const session = await openSessionOrRecord(identity.connection, () =>
    OdooAuthService.openSession(identity.connection, credential));

  if (options.feature) {
    await odooCapabilityService.assertFeature(session, identity.connection.id, options.feature);
  }

  return {
    session,
    connectionId: identity.connection.id,
    odooPartnerId: identity.odooPartnerId,
    odooCompanyId: identity.odooCompanyId,
  };
}

// Used to scope /users (portal user management) to "the acting Customer Admin's own customer
// organization". Reuses resolveIdentity rather than picking a mapping via `is_primary` -- a user
// can hold more than one identity_mapping (one per Odoo connection) with no guaranteed uniqueness
// on is_primary, so the only unambiguous way to know *which* mapping represents "them" for this
// action is the same signal every other endpoint already trusts: the company currently selected
// on their session (section 4/8). Never fed a company/customer id from the request body itself.
async function resolveUserManagementScope(actorUserId, currentCompanyId) {
  const identity = await resolveIdentity(actorUserId, currentCompanyId);
  const credential = crypto.decrypt(identity.connection.encrypted_credential);
  // findFamilyIds ber-authenticate sendiri (bukan lewat openSession), jadi ia butuh pembungkus
  // yang sama -- kalau tidak, /users adalah satu-satunya halaman pelanggan yang masih membocorkan
  // pesan kredensial mentah saat koneksinya bermasalah.
  const partnerIds = await openSessionOrRecord(identity.connection, () =>
    OdooPartnerService.findFamilyIds(identity.connection, credential, identity.odooPartnerId));

  return { odooConnectionId: identity.connection.id, partnerIds };
}

module.exports = { assertConnectionEnabled, resolveIdentity, resolveOdooContext, resolveUserManagementScope };

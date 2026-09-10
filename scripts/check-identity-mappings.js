// BUG-32 (resolution.md): id numerik Odoo hanya bermakna di dalam SATU database. Sebuah baris
// `identity_mappings` menyimpan `odoo_partner_id` telanjang -- tanpa apa pun yang mengikatnya ke
// database tempat id itu diberikan. Selama koneksinya tidak pernah dipindah, itu memang cukup;
// begitu `odoo_connections.database` berubah, setiap mapping lama diam-diam menunjuk pelanggan
// yang berbeda, dan tidak ada satu pun error yang muncul.
//
// `odooConnectionService.update()` kini menolak pemindahan itu (409 connection_target_locked),
// jadi drift BARU tidak bisa lagi lahir. Skrip ini untuk sisi yang tidak bisa ditutup oleh guard
// mana pun: drift yang SUDAH terlanjur ada sebelum guard itu dipasang, dan yang gejalanya
// ("kenapa pelanggan ini tidak punya history?") tidak pernah terlihat seperti masalah pemetaan.
//
// Yang diperiksa, per baris identity_mappings:
//   1. Partner-nya benar-benar ada di database koneksi itu. Tidak ada -> mapping mati total.
//   2. Email portal_user cocok dengan email di keluarga partner-nya di Odoo. Ini pemeriksaan yang
//      sebenarnya: partner yang ADA tapi milik pelanggan LAIN adalah kegagalan diam yang
//      berbahaya, bukan yang berisik.
//   3. Company yang dipegang user (`portal_user_companies`) berasal dari koneksi yang juga punya
//      mapping untuk user itu -- kombinasi partner koneksi A + company koneksi B tidak akan
//      pernah menghasilkan data, ia hanya berakhir 403 no_identity_mapping.
//
// Kecocokan email dilonggarkan dengan sengaja: partner induk sering tidak memegang email (yang
// memegang adalah kontak anaknya), jadi keluarga partner (D-4, commercial_partner_id) ikut
// diperiksa sebelum sebuah baris dinyatakan MISMATCH. Yang tidak bisa diputuskan otomatis
// dilaporkan UNVERIFIED, bukan dianggap lulus.
//
// Run: node scripts/check-identity-mappings.js [--connection=<odoo_connections.id>]
// Exits non-zero kalau ada mapping yang MISSING, MISMATCH, atau CROSS-CONN.
const pool = require('../src/db/pool');
const OdooAuthService = require('../src/integrations/odoo/OdooAuthService');
const crypto = require('../src/utils/crypto');

function parseArgs(argv) {
  const match = argv.find((arg) => arg.startsWith('--connection='));
  return { connectionId: match ? match.slice('--connection='.length) : null };
}

function normalizeEmail(value) {
  return (value || '').trim().toLowerCase();
}

// Nama dibandingkan hanya sebagai CADANGAN saat email tidak ada di mana pun dalam keluarga
// partner -- dan itu justru kasus yang melahirkan BUG-32: partner 8 di `pt_dira` ("ANUGRAH TEKNIK
// WISESA, PT") tidak memegang email sama sekali, jadi pemeriksaan berbasis email menyerah persis
// pada baris yang paling perlu ditangkap.
//
// `provisionFromOdoo` menyalin `res.partner.name` ke `portal_users.name`, jadi untuk user hasil
// provisioning perbandingan ini bermakna. Untuk user yang namanya diedit belakangan di portal ia
// bisa memberi positif palsu -- itu sebabnya basis perbandingannya selalu ikut dicetak: menolak
// satu baris yang ternyata cuma berganti nama butuh lima detik, sementara satu mapping yang diam-
// diam menunjuk pelanggan lain adalah insiden.
function namesAgree(a, b) {
  const norm = (value) => (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const left = norm(a);
  const right = norm(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

async function loadMappings(connectionId) {
  const { rows } = await pool.query(
    `SELECT im.id, im.odoo_partner_id, im.odoo_connection_id,
            u.id AS portal_user_id, u.email, u.name,
            c.name AS connection_name, c.database, c.url, c.username,
            c.auth_type, c.encrypted_credential
       FROM identity_mappings im
       JOIN portal_users u ON u.id = im.portal_user_id
       JOIN odoo_connections c ON c.id = im.odoo_connection_id
      WHERE ($1::uuid IS NULL OR im.odoo_connection_id = $1)
      ORDER BY c.name, u.email`,
    [connectionId]
  );
  return rows;
}

// Check 3, portal-side only -- no Odoo call needed, because the defect is structural: the company
// row simply belongs to a connection this user has no identity on, so resolveIdentity() raises
// 403 no_identity_mapping the moment that company is selected (the shape behind BUG-29).
async function loadCrossConnectionCompanies(connectionId) {
  const { rows } = await pool.query(
    `SELECT u.email, oc.name AS company_name, conn.name AS connection_name
       FROM portal_user_companies uc
       JOIN portal_users u ON u.id = uc.user_id
       JOIN odoo_companies oc ON oc.id = uc.odoo_company_id
       JOIN odoo_connections conn ON conn.id = oc.odoo_connection_id
      WHERE ($1::uuid IS NULL OR oc.odoo_connection_id = $1)
        AND NOT EXISTS (
          SELECT 1 FROM identity_mappings im
           WHERE im.portal_user_id = uc.user_id
             AND im.odoo_connection_id = oc.odoo_connection_id
        )
      ORDER BY u.email`,
    [connectionId]
  );
  return rows;
}

async function run() {
  const { connectionId } = parseArgs(process.argv.slice(2));
  const mappings = await loadMappings(connectionId);

  // One session per connection, not per mapping -- a connection with 200 mapped customers would
  // otherwise re-authenticate 200 times.
  const sessions = new Map();
  async function sessionFor(row) {
    if (sessions.has(row.odoo_connection_id)) return sessions.get(row.odoo_connection_id);
    let session = null;
    try {
      session = await OdooAuthService.openSession(row, crypto.decrypt(row.encrypted_credential));
    } catch (err) {
      console.log(`     (connection "${row.connection_name}" could not be opened: ${err.message})`);
    }
    sessions.set(row.odoo_connection_id, session);
    return session;
  }

  let broken = 0;
  let unverified = 0;
  let checked = 0;
  let currentConnection = null;

  for (const row of mappings) {
    if (currentConnection !== row.odoo_connection_id) {
      currentConnection = row.odoo_connection_id;
      console.log(`\n### ${row.connection_name}  (${row.url} / ${row.database})`);
    }
    const label = `partner ${row.odoo_partner_id} <- ${row.email}`;
    const session = await sessionFor(row);
    if (!session) {
      unverified += 1;
      console.log(`UNVERIFIED ${label} -- connection could not be opened`);
      continue;
    }

    checked += 1;
    const [partner] = await session.searchRead(
      'res.partner',
      [['id', '=', row.odoo_partner_id]],
      ['id', 'name', 'email', 'commercial_partner_id']
    );
    if (!partner) {
      broken += 1;
      console.log(`MISSING    ${label} -- no res.partner with this id exists in "${row.database}"`);
      continue;
    }

    const wanted = normalizeEmail(row.email);
    const candidates = new Set([normalizeEmail(partner.email)]);
    // D-4: the mapped partner is often the commercial root, whose own email is empty while a
    // child contact carries it. Checking the family is what keeps that shape from reading as a
    // mismatch -- the same expansion every customer-facing query already uses.
    const rootId = Array.isArray(partner.commercial_partner_id) ? partner.commercial_partner_id[0] : partner.id;
    const family = await session.searchRead('res.partner', [['commercial_partner_id', '=', rootId]], ['id', 'email']);
    for (const member of family) candidates.add(normalizeEmail(member.email));
    candidates.delete('');

    if (candidates.has(wanted)) {
      console.log(`OK         ${label} = "${partner.name}"`);
    } else if (candidates.size === 0) {
      if (namesAgree(row.name, partner.name)) {
        console.log(`OK         ${label} = "${partner.name}" (by name; no email in this partner family)`);
      } else {
        broken += 1;
        console.log(
          `MISMATCH   ${label} = "${partner.name}" -- no email in this partner family, and the `
          + `portal user is named "${row.name}" (compared by name)`
        );
      }
    } else {
      broken += 1;
      console.log(
        `MISMATCH   ${label} = "${partner.name}" -- that partner family's email(s) are `
        + `[${[...candidates].join(', ')}], not ${wanted}`
      );
    }
  }

  const orphans = await loadCrossConnectionCompanies(connectionId);
  if (orphans.length > 0) console.log('');
  for (const orphan of orphans) {
    broken += 1;
    console.log(
      `CROSS-CONN ${orphan.email} holds company "${orphan.company_name}" on connection `
      + `"${orphan.connection_name}", but has no identity_mapping there -- selecting it 403s`
    );
  }

  return { broken, unverified, checked };
}

run()
  .then(({ broken, unverified, checked }) => {
    console.log(`\n${checked} mapping(s) verified against Odoo, ${broken} broken, ${unverified} unverified`);
    if (broken > 0) {
      console.error('identity mapping check FAILED -- see MISSING/MISMATCH/CROSS-CONN rows above');
      process.exitCode = 1;
    } else {
      console.log('identity mapping check passed');
    }
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

// BUG-36 lalu BUG-37 (resolution.md): dua bug berturut-turut pada satu pertanyaan yang sama --
// company mana yang didudukkan pada sesi seorang pelanggan saat ia login.
//
// CR-047 memberi admin tombol untuk mematikan sebuah koneksi Odoo dan memasang gerbangnya di titik
// KONSUMSI (`resolveIdentity`), tapi tidak ada yang memberi tahu titik PEMILIHAN -- itu BUG-36.
// Perbaikan pertamanya salah arah: ia mendahulukan "koneksi yang menyala" di atas `is_default`,
// sehingga pelanggan dipindahkan ke DATABASE ODOO LAIN tempat ia adalah partner yang berbeda --
// itu BUG-37. Aturannya sekarang: `is_default` menang selalu, karena ia jawaban Odoo sendiri atas
// "pelanggan ini duduk di mana"; kesehatan koneksi hanya jadi tiebreak saat default itu tidak ada.
//
// Skrip ini untuk sisi yang tidak bisa ditutup guard mana pun: keadaan data yang SUDAH ada, dan
// yang gejalanya ("kenapa pelanggan ini tidak bisa membuka apa pun?") tidak pernah terlihat
// seperti akibat dari konfigurasi koneksi.
//
// Kursinya tidak ditebak melainkan dihitung dengan `companyService.pickDefaultCompany` -- fungsi
// yang SAMA yang dipakai `authService.issueSession` saat login sungguhan. Menyalin ulang aturannya
// di sini akan membuat keduanya berbeda pelan-pelan, dan skrip pemeriksa yang berbohong lebih
// buruk daripada tidak ada skrip sama sekali.
//
// Yang dilaporkan:
//   SEAT-DISABLED    -- kursi yang akan dipilih login ada di koneksi yang DIMATIKAN admin. Setiap
//                       login berhasil, lalu setiap halaman menjawab 503. Menggagalkan exit code.
//   SEAT-UNREACHABLE -- kursinya ada di koneksi yang menyala tapi `status = 'error'`: tidak
//                       terjangkau menurut kontak terakhir Odoo. Menggagalkan exit code.
//   NO-DEFAULT       -- company user tersebar di lebih dari satu KONEKSI tapi tidak ada
//                       `is_default` sama sekali. Hanya pada populasi ini identitas Odoo yang
//                       dipakai ditentukan oleh tiebreak, bukan oleh Odoo. CR-040 seharusnya
//                       mengisi default itu; barisnya di sini berarti ada jalur provisioning yang
//                       melewatinya. Menggagalkan exit code.
//   SEATED           -- sesi yang MASIH aktif dan saat ini duduk di koneksi mati. Pemiliknya cukup
//                       berganti company atau login ulang; dilaporkan, tidak menggagalkan.
//   TRAP             -- koneksi `is_enabled = true` tapi `status = 'error'`: menyala menurut admin,
//                       terbukti tidak terjangkau menurut Odoo. Kombinasi inilah yang membuat
//                       relokasi BUG-37 mendarat di tempat yang bahkan tidak bisa dihubungi.
//                       Hampir selalu berarti ada baris koneksi yang seharusnya dimatikan.
//
// Sengaja tidak menyentuh Odoo sama sekali: seluruh pertanyaannya bisa dijawab portal DB, dan
// menelepon koneksi yang justru sedang dimatikan adalah hal yang tidak masuk akal untuk dilakukan.
// Untuk pertanyaan "apakah partner-nya benar-benar orang yang sama", alatnya berbeda --
// `scripts/check-identity-mappings.js`, yang memang berbicara ke Odoo.
//
// Run: node scripts/check-company-selection.js
// Exits non-zero kalau ada SEAT-DISABLED, SEAT-UNREACHABLE, atau NO-DEFAULT.
const pool = require('../src/db/pool');
const companyService = require('../src/services/companyService');

async function run() {
  // Kolomnya sengaja dinamai persis seperti yang dikembalikan `odooCompanyRepository.listForUser`,
  // karena `pickDefaultCompany` di bawah membaca baris ini seolah-olah datang dari sana.
  const { rows } = await pool.query(
    `SELECT u.email,
            c.name          AS name,
            uc.is_default,
            conn.id         AS connection_id,
            conn.name       AS connection_name,
            conn.is_enabled AS connection_enabled,
            conn.status     AS connection_status
     FROM portal_users u
     JOIN portal_user_companies uc ON uc.user_id = u.id
     JOIN odoo_companies c         ON c.id = uc.odoo_company_id
     JOIN odoo_connections conn    ON conn.id = c.odoo_connection_id
     WHERE u.status = 'active'
     ORDER BY u.email, conn.name, c.name`
  );

  const byUser = new Map();
  for (const row of rows) {
    if (!byUser.has(row.email)) byUser.set(row.email, []);
    byUser.get(row.email).push(row);
  }

  let failing = 0;
  let warned = 0;

  for (const [email, companies] of byUser) {
    const seat = companyService.pickDefaultCompany(companies);
    if (!seat) continue; // tidak mungkin lewat JOIN di atas, tapi murah untuk dijaga

    const alternatives = companies.filter(
      (c) => c !== seat && c.connection_enabled !== false && c.connection_status !== 'error'
    );
    const wayOut = alternatives.length
      ? `Ada ${alternatives.length} company lain yang sehat -- pemiliknya bisa berganti sendiri lewat switcher.`
      : 'Tidak ada company lain yang sehat: hanya admin yang bisa memperbaikinya.';

    if (seat.connection_enabled === false) {
      failing += 1;
      console.log(
        `SEAT-DISABLED    ${email} -- login akan duduk di "${seat.name}" pada koneksi `
        + `"${seat.connection_name}" yang dimatikan. Setiap halaman menjawab 503 `
        + `odoo_connection_disabled. ${wayOut}`
      );
    } else if (seat.connection_status === 'error') {
      failing += 1;
      console.log(
        `SEAT-UNREACHABLE ${email} -- login akan duduk di "${seat.name}" pada koneksi `
        + `"${seat.connection_name}" yang menyala tapi status=error. ${wayOut}`
      );
    }

    const connections = new Set(companies.map((c) => c.connection_id));
    if (connections.size > 1 && !companies.some((c) => c.is_default)) {
      failing += 1;
      console.log(
        `NO-DEFAULT       ${email} -- company tersebar di ${connections.size} koneksi tanpa `
        + 'is_default. Identitas Odoo yang dipakai ditentukan tiebreak kesehatan koneksi, bukan oleh Odoo.'
      );
    }
  }

  // Sesi yang sudah terlanjur duduk di koneksi mati. Dibatasi ke sesi yang benar-benar masih bisa
  // dipakai -- sesi kedaluwarsa tidak menyusahkan siapa pun.
  const seated = await pool.query(
    `SELECT DISTINCT u.email, c.name AS company_name, conn.name AS connection_name
     FROM sessions s
     JOIN portal_users u        ON u.id = s.user_id
     JOIN odoo_companies c      ON c.id = s.current_company_id
     JOIN odoo_connections conn ON conn.id = c.odoo_connection_id
     WHERE s.status = 'active' AND s.expires_at > now() AND conn.is_enabled = false
     ORDER BY u.email`
  );
  for (const row of seated.rows) {
    warned += 1;
    console.log(
      `SEATED           ${row.email} -- sesi aktif masih duduk di "${row.company_name}" `
      + `(koneksi "${row.connection_name}" mati).`
    );
  }

  const traps = await pool.query(
    `SELECT name, url, database,
            (SELECT count(*)::int FROM identity_mappings m WHERE m.odoo_connection_id = conn.id) AS mappings
     FROM odoo_connections conn
     WHERE conn.is_enabled = true AND conn.status = 'error'
     ORDER BY name`
  );
  for (const row of traps.rows) {
    warned += 1;
    console.log(
      `TRAP             koneksi "${row.name}" (${row.url}, db ${row.database}) menyala tapi `
      + `status=error, ${row.mappings} identity mapping menggantung padanya.`
    );
  }

  return { users: byUser.size, failing, warned };
}

run()
  .then(({ users, failing, warned }) => {
    console.log(`\n${users} user aktif diperiksa, ${failing} temuan menggagalkan, ${warned} peringatan`);
    if (failing > 0) {
      console.error('company selection check FAILED -- lihat baris SEAT-*/NO-DEFAULT di atas');
      process.exitCode = 1;
    } else {
      console.log('company selection check passed');
    }
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

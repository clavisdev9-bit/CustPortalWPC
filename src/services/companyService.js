const odooCompanyRepository = require('../repositories/odooCompanyRepository');
const odooConnectionRepository = require('../repositories/odooConnectionRepository');
const sessionRepository = require('../repositories/sessionRepository');
const { assertConnectionEnabled } = require('./odooContext');
const ApiError = require('../utils/ApiError');

// CR-054: switcher hanya menawarkan company yang koneksinya bukan `error` -- kolom `status` yang
// sama persis yang dilihat admin di `/settings/odoo-connection`, jadi dua layar itu menjawab dari
// satu sumber. Koneksi yang terbukti tidak bisa dihubungi tidak punya data untuk ditampilkan;
// menawarkannya cuma memindahkan kegagalan satu klik lebih jauh ke dalam.
//
// `status` dan BUKAN `is_enabled` -- itu perbedaan yang menentukan, dan pelajaran BUG-37. Untuk
// data yang sama keduanya menjawab terbalik: `is_enabled` menyembunyikan `PT DIRA` (satu-satunya
// company yang cocok dengan `company_id` pelapor di Odoo) sambil membiarkan `Main Odoo` yang
// url-nya tidak pernah ada. `status` membalik keduanya dengan benar -- koneksi yang dimatikan
// admin tapi sehat tetap terlihat (lalu ditolak dengan alasan saat dipilih), sedangkan yang
// terbukti tidak terjangkau hilang.
//
// Yang disaring `!== 'error'`, bukan `=== 'connected'`, dan bedanya adalah baris `pending`: sebuah
// koneksi yang belum pernah dihubungi sama sekali. Menyembunyikan koneksi karena statusnya TIDAK
// DIKETAHUI adalah bentuk kegagalan yang sama dengan BUG-37 -- menghilangkan company pelanggan
// tanpa jejak. Hanya kegagalan yang sudah terbukti yang boleh menghilangkan pilihan.
//
// Jalur pulihnya perlu diketahui, karena TIDAK otomatis untuk semua baris: `status` dikembalikan
// ke `connected` oleh `odooConnectionHealth.recordSuccess`, yang hanya berjalan saat ada sesi yang
// memang sedang DUDUK di koneksi itu (CR-045). Koneksi kedua milik seorang user yang sempat
// `error` karena itu tidak bisa pulih dari lalu lintas user tersebut -- ia tersaring, jadi tidak
// pernah dipilih, jadi tidak pernah dihubungi. Yang memutus lingkaran itu adalah Test Connection
// di `/settings/odoo-connection`, yang juga menulis `status` -- dan itu memang halaman yang jadi
// sumber aturan ini.
//
// Dua pagar supaya penyaringan ini tidak pernah bisa berbohong:
//
//   1. Company yang SEDANG diduduki sesi selalu ikut, apa pun statusnya. Tanpa ini `<select>`
//      yang dikendalikan `current?.id` menunjuk option yang tidak ada, dan browser menampilkan
//      entri pertama -- layar yang menyebut company yang bukan tempat sesi itu berada.
//   2. Kalau penyaringan menyisakan nol, daftarnya ditampilkan apa adanya. Array kosong dirender
//      "No company assigned", yang terbaca sebagai "admin belum memberimu perusahaan" padahal
//      yang terjadi adalah Odoo-nya sedang tidak terjangkau.
//
// Yang dibuang hanyalah dua kolom kesehatan koneksi: keduanya milik tiebreak `pickDefaultCompany`,
// bukan bagian dari skema `Company`, dan membocorkannya ke klien akan membatalkan penyamaran yang
// sengaja dipilih `assertConnectionEnabled` pada kode error-nya.
async function listForUser(userId, currentCompanyId = null) {
  const companies = await odooCompanyRepository.listForUser(userId);
  const offered = companies.filter(
    (c) => c.connection_status !== 'error' || c.id === currentCompanyId
  );
  const visible = offered.length ? offered : companies;
  return visible.map(({ connection_enabled, connection_status, ...company }) => company);
}

// BUG-37: company mana yang didudukkan pada sebuah sesi. Tinggal di sini, bukan sebagai baris
// inline di `issueSession`, karena ada dua pemanggil yang WAJIB sepakat: login yang benar-benar
// mendudukkan user, dan `scripts/check-company-selection.js` yang melaporkan siapa saja yang akan
// mendarat di tempat yang tidak bisa dipakai. Skrip yang menyalin ulang aturannya akan berbeda
// pelan-pelan, dan skrip pemeriksa yang berbohong lebih buruk daripada tidak ada skrip sama sekali.
//
// `is_default` menang, selalu. Ia bukan preferensi tampilan: sejak CR-040 ia diisi dari
// `company_id` milik kontak itu sendiri di Odoo, jadi ia jawaban ODOO atas "pelanggan ini duduk
// di mana". Company lain milik user hampir selalu ada di KONEKSI lain -- yang berarti DATABASE
// Odoo lain, tempat id partner yang sama menunjuk orang yang berbeda (BUG-32). Menggesernya
// karena koneksinya sedang dimatikan admin berarti portal memutuskan pelanggan ini sebenarnya
// siapa, dan itu tidak pernah jadi wewenangnya.
//
// Tanpa `is_default` sama sekali, pilihannya memang arbitrer (dulu `companies[0]`). Hanya di situ
// kesehatan koneksi jadi tiebreak yang masuk akal -- dan `is_enabled` saja tidak cukup: koneksi
// bisa menyala menurut admin tapi `status = 'error'` menurut Odoo.
function pickDefaultCompany(companies) {
  return companies.find((c) => c.is_default)
    || companies.find((c) => c.connection_enabled !== false && c.connection_status !== 'error')
    || companies.find((c) => c.connection_enabled !== false)
    || companies[0]
    || null;
}

async function getCurrent(currentCompanyId) {
  if (!currentCompanyId) return null;
  return odooCompanyRepository.findById(currentCompanyId);
}

// Every transaction is scoped to the active company once switched (section 23) -- this is the
// one place that enforces a user can only select a company they were explicitly granted.
async function switchCompany({ userId, sessionId, companyId }) {
  const hasAccess = await odooCompanyRepository.userHasAccess(userId, companyId);
  if (!hasAccess) throw new ApiError(403, 'forbidden_company', 'User is not authorized for this company');

  // BUG-36: menyaring daftar bukan penegakan. Tab SPA yang sudah lama terbuka masih memegang id
  // company dari sebelum koneksinya dimatikan, dan tanpa pemeriksaan ini `POST /companies/switch`
  // dengan senang hati memindahkan sesi ke sana -- menukar company yang bekerja dengan yang
  // menjawab 503 pada setiap permintaan sesudahnya. Sengaja memakai gerbang yang sama persis
  // dengan `resolveIdentity`, supaya satu keadaan tidak punya dua penjelasan.
  //
  // Koneksi yang barisnya hilang dilewatkan, bukan ditolak di sini: `resolveIdentity` sudah punya
  // jawaban sendiri untuk itu (404), dan menduplikasinya hanya menambah tempat yang bisa berbeda.
  const company = await odooCompanyRepository.findById(companyId);
  if (company) {
    const connection = await odooConnectionRepository.findById(company.odoo_connection_id);
    if (connection) assertConnectionEnabled(connection);
  }

  await sessionRepository.updateCurrentCompany(sessionId, companyId);
  return company;
}

module.exports = { listForUser, getCurrent, switchCompany, pickDefaultCompany };

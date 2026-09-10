const odooConnectionRepository = require('../repositories/odooConnectionRepository');

// BUG-30: CR-044 menutup jalur TULIS (`POST /` dan `PATCH /:id` kini memvalidasi kredensial ke
// Odoo sebelum menyimpan), tapi tidak ada apa pun yang menutup jalur BACA. Kredensial yang dulu
// benar-benar terverifikasi tetap bisa basi belakangan tanpa satu baris kode portal pun berubah:
// password di-rotate di Odoo, user integrasinya dinonaktifkan, API key dicabut. Sejak itu setiap
// permintaan pelanggan gagal `odoo_auth_failed`, sementara `odoo_connections.status` masih
// mengatakan `connected` dari pemeriksaan terakhir berminggu-minggu lalu -- halaman admin hijau,
// pelanggan terkunci total, dan tidak ada satu sinyal pun yang menghubungkan keduanya.
//
// Modul ini menjadikan permintaan pelanggan sungguhan sebagai health check: hasil `openSession`
// pada jalur normal ditulis balik ke baris koneksi, jadi `status` mencerminkan keadaan Odoo
// sekarang -- bukan kapan terakhir seorang admin ingat menekan Test Connection.
//
// Berdiri sendiri, tidak di dalam `odooConnectionService`, untuk menghindari require cycle:
// odooContext -> odooConnectionService -> userService -> odooContext. Di sini dependensinya hanya
// repository, jadi tidak ada siklus. Ini juga alasan modul ini bicara ke repository langsung
// alih-alih lewat service koneksi.

// Satu koneksi yang rusak dipakai banyak user sekaligus; tanpa throttle, badai permintaan yang
// semuanya gagal berarti satu UPDATE per permintaan ke baris yang sama.
const RECORD_INTERVAL_MS = 60_000;
const lastRecordedAt = new Map();

function shouldWrite(connectionId) {
  const previous = lastRecordedAt.get(connectionId);
  if (previous && Date.now() - previous < RECORD_INTERVAL_MS) return false;
  lastRecordedAt.set(connectionId, Date.now());
  return true;
}

// Pencatatan kesehatan tidak boleh pernah menggantikan kegagalan aslinya: pemanggil sedang berada
// di jalur error dan yang harus sampai ke pengguna adalah error Odoo-nya, bukan error UPDATE.
async function safeUpdate(connectionId, patch) {
  try {
    await odooConnectionRepository.update(connectionId, patch);
  } catch (err) {
    console.error(`[odooConnectionHealth] gagal mencatat status koneksi ${connectionId}:`, err.message);
  }
}

// `connection` adalah baris yang sudah dimuat pemanggil (resolveIdentity), jadi status lamanya
// sudah di tangan -- dipakai untuk menekan UPDATE yang tidak mengubah apa pun.
async function recordSuccess(connection) {
  if (connection.status === 'connected' && !connection.last_error) return;
  await safeUpdate(connection.id, {
    status: 'connected',
    last_checked_at: new Date(),
    last_error: null,
  });
}

// Hanya dipanggil untuk kegagalan `openSession` (authenticate), yang berarti kredensial ditolak
// atau server tidak terjangkau. Kegagalan `execute_kw` sesudah sesi terbuka (`odoo_call_failed`,
// mis. field yang tidak valid di `search_read`) SENGAJA tidak dianggap masalah kesehatan koneksi
// -- itu bug kode portal, dan menandai koneksinya `error` hanya akan menyembunyikannya.
async function recordFailure(connection, message) {
  // Throttle-nya HANYA boleh bergantung pada "baris ini sudah berstatus error", bukan pada teks
  // errornya. Versi pertama membandingkan `last_error === message` juga, dan itu justru membatalkan
  // throttle-nya persis saat paling dibutuhkan: teks error jaringan Odoo berubah tiap percobaan
  // ("socket hang up", "ETIMEDOUT", "ECONNRESET"), jadi setiap permintaan terlihat "berubah" dan
  // menulis ulang baris yang sama -- badai UPDATE yang throttle ini ada untuk mencegah.
  //
  // Transisi sehat -> error tetap ditulis seketika: itu satu-satunya kejadian yang benar-benar
  // baru, dan menundanya sampai 60 detik akan menunda pula satu-satunya sinyal yang dilihat admin.
  if (connection.status === 'error' && !shouldWrite(connection.id)) return;
  lastRecordedAt.set(connection.id, Date.now());
  await safeUpdate(connection.id, {
    status: 'error',
    last_checked_at: new Date(),
    last_error: message,
  });
}

module.exports = { recordSuccess, recordFailure };

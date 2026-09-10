const pool = require('../db/pool');

async function create({ sessionId, tokenHash, expiresAt }) {
  const { rows } = await pool.query(
    'INSERT INTO refresh_tokens (session_id, token_hash, expires_at) VALUES ($1, $2, $3) RETURNING *',
    [sessionId, tokenHash, expiresAt]
  );
  return rows[0];
}

async function findActiveByHash(tokenHash) {
  const { rows } = await pool.query(
    `SELECT * FROM refresh_tokens WHERE token_hash = $1 AND status = 'active' AND expires_at > now()`,
    [tokenHash]
  );
  return rows[0] || null;
}

// BUG-33. `AND status = 'active'` adalah inti perbaikannya, bukan pengetatan kosmetik.
//
// Sebelum ini rotasi menimpa baris apa pun tanpa syarat, sementara authService.refresh membacanya
// lebih dulu lewat findActiveByHash -- pola baca-lalu-tulis klasik. Dua permintaan refresh yang
// datang bersamaan dengan token yang SAMA sama-sama lolos pemeriksaan, sama-sama membuat baris
// baru, dan sama-sama merotasi baris lama: hasilnya satu sesi dengan DUA refresh token aktif, dan
// sifat "sekali pakai" yang dijanjikan komentar di client.js sebenarnya tidak pernah ditegakkan.
// Bukan teori: tiga sesi di DB dev ini memegang dua token aktif yang lahir 5 ms, 8 ms, dan 18 ms
// berselisih (lihat BUG-33 di resolution.md).
//
// Dengan syarat ini hanya SATU pemanggil yang bisa memenangkan transisi active -> rotated;
// UPDATE ... WHERE status = 'active' bersifat atomik di dalam satu baris, jadi tidak butuh
// transaksi eksplisit maupun SELECT ... FOR UPDATE. Yang kalah menerima `false` dan wajib
// memperlakukan token itu sebagai sudah terpakai.
//
// Mengembalikan boolean, bukan void: pemanggil harus bisa membedakan "berhasil dirotasi" dari
// "sudah dirotasi orang lain", dan itu satu-satunya alasan nilai baliknya ada.
async function rotate(id, newTokenId) {
  const { rows } = await pool.query(
    `UPDATE refresh_tokens SET status = 'rotated', rotated_to_id = $2
      WHERE id = $1 AND status = 'active' RETURNING id`,
    [id, newTokenId]
  );
  return rows.length > 0;
}

// BUG-33. Untuk membatalkan baris yang terlanjur dibuat oleh pemanggil yang kalah balapan rotasi.
// Barisnya sengaja tidak dihapus: satu baris `revoked` adalah jejak bahwa refresh bersamaan pernah
// terjadi, dan itu justru sinyal yang dicari saat menyelidiki sesi yang tiba-tiba logout.
async function revokeById(id) {
  await pool.query(`UPDATE refresh_tokens SET status = 'revoked' WHERE id = $1`, [id]);
}

async function revokeBySession(sessionId) {
  await pool.query(`UPDATE refresh_tokens SET status = 'revoked' WHERE session_id = $1 AND status = 'active'`, [sessionId]);
}

module.exports = { create, findActiveByHash, rotate, revokeById, revokeBySession };

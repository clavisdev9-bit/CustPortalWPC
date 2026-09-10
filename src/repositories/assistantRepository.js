const pool = require('../db/pool');

// Jejak percakapan asisten. Setiap pembacaan di-scope ke (portal_user_id, odoo_connection_id):
// user bisa punya identity_mapping ke lebih dari satu Odoo connection (odooContext.js), dan
// riwayat dari connection lain tidak boleh muncul di bawah company yang sedang aktif.

// ----------------------------------------------------------- conversations --

async function createConversation({ portalUserId, odooConnectionId, locale, title }) {
  const { rows } = await pool.query(
    `INSERT INTO assistant_conversations (portal_user_id, odoo_connection_id, locale, title)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [portalUserId, odooConnectionId, locale, title || null]
  );
  return rows[0];
}

// Baik portal_user_id maupun odoo_connection_id ikut di WHERE, bukan hanya id: percakapan milik
// orang lain -- atau milik user yang sama tapi di connection lain -- harus tidak ditemukan,
// bukan ditemukan lalu ditolak. Pemanggil menerjemahkan null jadi 404.
async function findConversation(id, portalUserId, odooConnectionId) {
  const { rows } = await pool.query(
    `SELECT * FROM assistant_conversations
     WHERE id = $1 AND portal_user_id = $2 AND odoo_connection_id = $3`,
    [id, portalUserId, odooConnectionId]
  );
  return rows[0] || null;
}

async function listConversations(portalUserId, odooConnectionId, limit = 30) {
  const { rows } = await pool.query(
    `SELECT id, locale, title, created_at, last_message_at
     FROM assistant_conversations
     WHERE portal_user_id = $1 AND odoo_connection_id = $2 AND anonymized_at IS NULL
     ORDER BY last_message_at DESC
     LIMIT $3`,
    [portalUserId, odooConnectionId, limit]
  );
  return rows;
}

// Hapus permanen, bukan soft-delete: ini kontrol privasi user (section 10.1), dan "dihapus"
// yang sebenarnya masih tersimpan adalah janji yang dilanggar. ON DELETE CASCADE di
// assistant_messages/drafts/feedback ikut membersihkan turunannya.
async function deleteConversation(id, portalUserId, odooConnectionId) {
  const { rowCount } = await pool.query(
    `DELETE FROM assistant_conversations
     WHERE id = $1 AND portal_user_id = $2 AND odoo_connection_id = $3`,
    [id, portalUserId, odooConnectionId]
  );
  return rowCount > 0;
}

// Judul diambil dari pesan pertama user, dipotong -- cukup untuk mengenali percakapan di daftar
// riwayat tanpa memanggil LLM lagi hanya untuk meringkas satu kalimat.
async function setTitleIfEmpty(id, title) {
  await pool.query(
    'UPDATE assistant_conversations SET title = $2 WHERE id = $1 AND title IS NULL',
    [id, title.slice(0, 200)]
  );
}

async function touchConversation(id) {
  await pool.query('UPDATE assistant_conversations SET last_message_at = now() WHERE id = $1', [id]);
}

// --------------------------------------------------------------- messages --

async function appendMessage({
  conversationId, role, content, toolName, toolArgs, toolSummary,
  cardType, cardRef, model, tokenIn, tokenOut, latencyMs, errorCode,
}) {
  const { rows } = await pool.query(
    `INSERT INTO assistant_messages
       (conversation_id, role, content, tool_name, tool_args, tool_summary,
        card_type, card_ref, model, token_in, token_out, latency_ms, error_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      conversationId, role, content || null, toolName || null,
      toolArgs ? JSON.stringify(toolArgs) : null, toolSummary || null,
      cardType || null, cardRef ? JSON.stringify(cardRef) : null,
      model || null, tokenIn || null, tokenOut || null, latencyMs || null, errorCode || null,
    ]
  );
  return rows[0];
}

async function listMessages(conversationId) {
  const { rows } = await pool.query(
    `SELECT m.*, f.rating AS feedback_rating
     FROM assistant_messages m
     LEFT JOIN assistant_feedback f ON f.message_id = m.id
     WHERE m.conversation_id = $1
     ORDER BY m.created_at, m.id`,
    [conversationId]
  );
  return rows;
}

// Hanya role user/assistant yang dikembalikan, dan hanya `limit` terakhir: baris role='tool'
// tidak diputar ulang ke model. Ringkasannya sudah terserap ke dalam jawaban assistant yang
// mengikutinya, dan mengirim ulang seluruh ringkasan tool tiap giliran akan menggelembungkan
// konteks tanpa menambah informasi.
async function listRecentTurns(conversationId, limit) {
  const { rows } = await pool.query(
    `SELECT role, content FROM (
       SELECT role, content, created_at, id FROM assistant_messages
       WHERE conversation_id = $1 AND role IN ('user', 'assistant') AND content IS NOT NULL
       ORDER BY created_at DESC, id DESC
       LIMIT $2
     ) recent
     ORDER BY created_at, id`,
    [conversationId, limit]
  );
  return rows;
}

// Dipakai untuk mengetahui BERAPA giliran yang dipotong jendela riwayat. listRecentTurns sendiri
// tidak bisa menjawab itu -- ia sudah ter-LIMIT, jadi hasilnya tidak pernah lebih besar dari
// jendelanya dan selisihnya selalu nol.
async function countTurns(conversationId) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS total FROM assistant_messages
     WHERE conversation_id = $1 AND role IN ('user', 'assistant') AND content IS NOT NULL`,
    [conversationId]
  );
  return rows[0].total;
}

// Kuota harian (section 10.4): hitung pesan role='user' milik user ini hari ini, lintas semua
// percakapannya di connection aktif. Batas hari memakai zona waktu server -- kuota "per hari"
// yang bergeser mengikuti setiap klien akan mustahil dijelaskan ke pengguna.
async function countUserMessagesToday(portalUserId, odooConnectionId) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS total
     FROM assistant_messages m
     JOIN assistant_conversations c ON c.id = m.conversation_id
     WHERE c.portal_user_id = $1 AND c.odoo_connection_id = $2
       AND m.role = 'user' AND m.created_at >= date_trunc('day', now())`,
    [portalUserId, odooConnectionId]
  );
  return rows[0].total;
}

// ----------------------------------------------------------------- drafts --

// Draf aksi tulis (I-5). Baris ini adalah SATU-SATUNYA jejak niat pengguna antara "model
// menyiapkan sesuatu" dan "pengguna menekan tombol" -- ia disimpan server-side, bukan
// dikembalikan ke klien lalu dikirim balik, supaya payload yang dieksekusi dijamin payload
// yang sama dengan yang ditinjau pengguna.
async function createDraft({ conversationId, portalUserId, action, payload, expiresAt }) {
  const { rows } = await pool.query(
    `INSERT INTO assistant_action_drafts (conversation_id, portal_user_id, action, payload, expires_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [conversationId, portalUserId, action, JSON.stringify(payload), expiresAt]
  );
  return rows[0];
}

// Join ke conversations, sama seperti findMessageForUser: kepemilikan diverifikasi di query yang
// sama, dan odoo_connection_id ikut supaya draf dari connection lain tidak bisa dikonfirmasi di
// bawah company yang sedang aktif. Pemanggil menerjemahkan null jadi 404, bukan 403 -- draf orang
// lain harus tidak bisa dibedakan dari draf yang tidak ada.
async function findDraftForUser(draftId, portalUserId, odooConnectionId) {
  const { rows } = await pool.query(
    `SELECT d.* FROM assistant_action_drafts d
     JOIN assistant_conversations c ON c.id = d.conversation_id
     WHERE d.id = $1 AND d.portal_user_id = $2 AND c.odoo_connection_id = $3`,
    [draftId, portalUserId, odooConnectionId]
  );
  return rows[0] || null;
}

// Transisi status ditulis dengan syarat `status = 'pending'` di dalam WHERE, bukan hanya dicek
// di controller: dua klik yang tiba bersamaan sama-sama lolos pemeriksaan controller, tapi hanya
// satu yang bisa memenangkan UPDATE ini. rowCount 0 = kalah balapan, dan pemanggil harus
// memperlakukannya sebagai "sudah tidak pending", bukan sebagai kegagalan.
async function markDraftConfirmed(draftId, resultRef) {
  const { rows } = await pool.query(
    `UPDATE assistant_action_drafts
     SET status = 'confirmed', confirmed_at = now(), result_ref = $2
     WHERE id = $1 AND status = 'pending'
     RETURNING *`,
    [draftId, resultRef]
  );
  return rows[0] || null;
}

async function markDraftStatus(draftId, status) {
  const { rows } = await pool.query(
    `UPDATE assistant_action_drafts SET status = $2
     WHERE id = $1 AND status = 'pending'
     RETURNING *`,
    [draftId, status]
  );
  return rows[0] || null;
}

// Pengguna boleh memperbaiki draf sebelum mengirim -- model sering hampir benar, dan memaksa
// mengulang percakapan hanya karena subjeknya kurang tepat itu menyebalkan. Editnya ditulis ke
// baris draf, BUKAN dititipkan lewat body confirm: dengan begitu properti "payload yang
// dieksekusi adalah payload yang ditinjau" tetap utuh, dan jejak auditnya menunjukkan apa yang
// benar-benar dikirim, bukan apa yang mula-mula disarankan model.
async function updateDraftPayload(draftId, payload) {
  const { rows } = await pool.query(
    `UPDATE assistant_action_drafts SET payload = $2
     WHERE id = $1 AND status = 'pending'
     RETURNING *`,
    [draftId, JSON.stringify(payload)]
  );
  return rows[0] || null;
}

// Dipakai widget untuk memunculkan kembali draf yang belum ditindaklanjuti saat percakapan lama
// dibuka. Yang kedaluwarsa tidak ikut -- menampilkan tombol Kirim yang pasti ditolak hanya
// membuat pengguna mengklik lalu melihat error.
async function listPendingDrafts(conversationId) {
  const { rows } = await pool.query(
    `SELECT * FROM assistant_action_drafts
     WHERE conversation_id = $1 AND status = 'pending' AND expires_at > now()
     ORDER BY created_at`,
    [conversationId]
  );
  return rows;
}

// --------------------------------------------------------------- feedback --

// Join ke conversations supaya kepemilikan diverifikasi di query yang sama -- tanpa ini, id
// pesan orang lain yang bocor/ditebak bisa dinilai oleh siapa saja.
async function findMessageForUser(messageId, portalUserId, odooConnectionId) {
  const { rows } = await pool.query(
    `SELECT m.* FROM assistant_messages m
     JOIN assistant_conversations c ON c.id = m.conversation_id
     WHERE m.id = $1 AND c.portal_user_id = $2 AND c.odoo_connection_id = $3`,
    [messageId, portalUserId, odooConnectionId]
  );
  return rows[0] || null;
}

async function upsertFeedback({ messageId, rating, reason }) {
  const { rows } = await pool.query(
    `INSERT INTO assistant_feedback (message_id, rating, reason)
     VALUES ($1, $2, $3)
     ON CONFLICT (message_id) DO UPDATE SET rating = EXCLUDED.rating, reason = EXCLUDED.reason
     RETURNING *`,
    [messageId, rating, reason || null]
  );
  return rows[0];
}

module.exports = {
  createConversation,
  findConversation,
  listConversations,
  deleteConversation,
  setTitleIfEmpty,
  touchConversation,
  appendMessage,
  listMessages,
  listRecentTurns,
  countTurns,
  countUserMessagesToday,
  createDraft,
  findDraftForUser,
  markDraftConfirmed,
  markDraftStatus,
  updateDraftPayload,
  listPendingDrafts,
  findMessageForUser,
  upsertFeedback,
};

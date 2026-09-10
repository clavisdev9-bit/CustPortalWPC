// Alur aksi tulis asisten (I-5): membuat draf, menyuntingnya, mengeksekusinya, membatalkannya.
//
// Dua sisi alur ini SENGAJA hidup di modul yang sama supaya kontraknya tidak bisa menyimpang --
// tapi keduanya hanya bisa dicapai lewat dua permintaan HTTP berbeda. `create` dipanggil tool
// LLM; `confirm` hanya dipanggil endpoint yang dipicu klik pengguna. Tidak ada satu pun jalur
// dari `create` ke `confirm` di dalam file ini, dan itu properti yang harus tetap benar.
const ApiError = require('../../utils/ApiError');
const assistantRepository = require('../../repositories/assistantRepository');
const helpdeskService = require('../helpdeskService');
const permissions = require('./permissions');
const actions = require('./actions');

// 30 menit (usul spec section 13). Draf tanpa kedaluwarsa adalah tombol kirim yang menganggur di
// riwayat percakapan selama berbulan-bulan -- dan konteks yang membuatnya masuk akal sudah lama
// hilang dari ingatan pengguna saat mereka menemukannya lagi.
const DRAFT_TTL_MS = 30 * 60 * 1000;

// Transkrip dilampirkan sebagai balasan pertama supaya staf membaca tiket bersama konteks yang
// melahirkannya -- tanpa itu mereka menerima ringkasan tanpa riwayat, lalu bertanya ulang hal
// yang sudah dijawab pelanggan ke asisten.
const TRANSCRIPT_MAX_CHARS = 4000;

function buildTranscript(messages) {
  const lines = messages
    .filter((m) => m.role !== 'tool' && m.content)
    .map((m) => `${m.role === 'user' ? 'Pelanggan' : 'Asisten'}: ${m.content}`);

  let body = lines.join('\n\n');
  if (body.length > TRANSCRIPT_MAX_CHARS) {
    // Dipotong dari DEPAN, bukan dari belakang: bagian akhir percakapan adalah yang paling dekat
    // dengan masalah yang akhirnya ditiketkan.
    body = `[bagian awal percakapan dipotong]\n\n${body.slice(-TRANSCRIPT_MAX_CHARS)}`;
  }
  return `Transkrip percakapan dengan Asisten Portal:\n\n${body}`;
}

function specFor(action) {
  const spec = actions.get(action);
  if (!spec) throw new ApiError(500, 'unknown_action', `Unknown assistant action: ${action}`);
  return spec;
}

// Dipakai `create`, `confirm`, `update`, dan `cancel`. 404 (bukan 403) disengaja: draf orang lain
// harus tidak bisa dibedakan dari draf yang tidak ada.
async function loadOwnDraft(draftId, userId, connectionId) {
  const draft = await assistantRepository.findDraftForUser(draftId, userId, connectionId);
  if (!draft) throw new ApiError(404, 'not_found', 'Draft not found');
  return draft;
}

// --------------------------------------------------------------- membuat --

async function create(ctx, action, rawArgs) {
  const spec = specFor(action);

  // Divalidasi dengan skema yang sama dipakai endpoint aslinya, sejak saat draf dibuat. Menunda
  // validasi ke `confirm` berarti model bisa menghasilkan draf yang pasti ditolak, pengguna
  // membacanya, menekan Kirim, lalu baru melihat error -- padahal kegagalannya sudah bisa
  // diketahui dan diperbaiki model beberapa detik sebelumnya.
  const payload = spec.draftSchema.parse(rawArgs);

  return assistantRepository.createDraft({
    conversationId: ctx.conversationId,
    portalUserId: ctx.userId,
    action,
    payload,
    expiresAt: new Date(Date.now() + DRAFT_TTL_MS),
  });
}

// -------------------------------------------------------------- menyunting --

async function update(userId, companyId, connectionId, draftId, rawPayload) {
  const draft = await loadOwnDraft(draftId, userId, connectionId);
  if (draft.status !== 'pending') {
    throw new ApiError(409, 'draft_not_pending', `This draft has already been ${draft.status}`);
  }

  // Suntingan pengguna divalidasi dengan draftSchema yang lebih ketat, bukan skema REST:
  // ia harus memenuhi standar yang sama dengan draf buatan model -- termasuk uraian yang wajib
  // ada. Lebih longgar berarti pengguna bisa mengosongkan justru bagian yang membuat tiketnya
  // berguna bagi staf.
  const spec = specFor(draft.action);
  const payload = spec.draftSchema.parse(rawPayload);

  const updated = await assistantRepository.updateDraftPayload(draft.id, payload);
  if (!updated) throw new ApiError(409, 'draft_not_pending', 'This draft is no longer editable');
  return updated;
}

// -------------------------------------------------------------- eksekusi --

async function confirm(userId, companyId, connectionId, draftId) {
  // 1. Ada DAN milik pemanggil.
  const draft = await loadOwnDraft(draftId, userId, connectionId);

  // 2. Masih pending.
  if (draft.status !== 'pending') {
    throw new ApiError(409, 'draft_not_pending', `This draft has already been ${draft.status}`);
  }

  // 3. Belum kedaluwarsa. Ditandai expired supaya tidak terus muncul sebagai draf menunggu.
  if (new Date(draft.expires_at) < new Date()) {
    await assistantRepository.markDraftStatus(draft.id, 'expired');
    throw new ApiError(410, 'draft_expired', 'This draft has expired. Please ask the assistant again.');
  }

  const spec = specFor(draft.action);

  // 4. Payload DIVALIDASI ULANG dengan skema endpoint aslinya. Payload di DB lahir dari keluaran
  //    LLM; mempercayainya karena "sudah tersimpan" sama dengan mempercayai LLM lewat jalan memutar.
  const payload = spec.schema.parse(draft.payload);

  // 5. Permission aksi diperiksa DI SINI juga, bukan hanya saat draf dibuat -- peran pengguna
  //    bisa dicabut dalam 30 menit antara draf dan konfirmasi.
  await permissions.assertPermission(userId, spec.permission);

  // 6. Klaim hak eksekusi SEBELUM memanggil service. Dua klik yang tiba bersamaan sama-sama lolos
  //    lima pemeriksaan di atas; hanya satu yang bisa memenangkan UPDATE bersyarat ini, dan yang
  //    kalah berhenti di sini alih-alih membuat record kedua.
  const claimed = await assistantRepository.markDraftStatus(draft.id, 'confirmed');
  if (!claimed) throw new ApiError(409, 'draft_not_pending', 'This draft is already being processed');

  let result;
  try {
    result = await spec.execute(userId, companyId, payload);
  } catch (err) {
    // Eksekusi gagal (Odoo mati, order milik orang lain, ...) -- kembalikan draf ke pending supaya
    // pengguna bisa mencoba lagi tanpa menyusun ulang keluhannya dari nol.
    await assistantRepository.markDraftStatus(draft.id, 'pending');
    throw err;
  }

  const resultRef = spec.resultRef(result);
  await assistantRepository.markDraftConfirmed(draft.id, resultRef);

  // Best-effort: record-nya SUDAH ada. Gagal melampirkan transkrip tidak boleh membatalkan apa pun
  // maupun mengembalikan error -- dari sudut pandang pengguna permintaannya berhasil.
  const ticketId = spec.ticketId(result);
  if (ticketId) {
    const messages = await assistantRepository.listMessages(draft.conversation_id);
    await helpdeskService
      .replyTicket(userId, companyId, ticketId, buildTranscript(messages))
      .catch((err) => console.error(`Failed to attach assistant transcript to ticket ${ticketId}:`, err.message));
  }

  const label = spec.label(result);

  // Dicatat sebagai giliran asisten supaya hasilnya ikut terlihat saat percakapan dibuka lagi.
  // Angkanya (nomor tiket) berasal dari hasil service, bukan diketik model -- I-4 tetap utuh.
  await assistantRepository.appendMessage({
    conversationId: draft.conversation_id,
    role: 'assistant',
    content: `Sudah terkirim: ${label}.`,
  });
  await assistantRepository.touchConversation(draft.conversation_id);

  return {
    action: draft.action,
    result,
    label,
    deepLink: spec.deepLink(result),
    targetType: spec.targetType,
    resultRef,
  };
}

// ------------------------------------------------------------- pembatalan --

async function cancel(userId, companyId, connectionId, draftId) {
  const draft = await loadOwnDraft(draftId, userId, connectionId);
  const cancelled = await assistantRepository.markDraftStatus(draft.id, 'cancelled');
  if (!cancelled) throw new ApiError(409, 'draft_not_pending', `This draft has already been ${draft.status}`);
  return cancelled;
}

module.exports = { create, update, confirm, cancel, buildTranscript, DRAFT_TTL_MS };

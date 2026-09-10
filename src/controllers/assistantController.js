const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const assistantService = require('../services/assistantService');
const assistantConfigService = require('../services/assistantConfigService');
const promptBuilder = require('../services/assistant/promptBuilder');
const assistantRepository = require('../repositories/assistantRepository');
const draftService = require('../services/assistant/draftService');
const auditService = require('../services/auditService');
const { resolveIdentity } = require('../services/odooContext');
const { chatSchema, feedbackSchema } = require('../validators/assistantValidators');

// I-3: userId/companyId hanya dari req.user (authenticate.js), tidak pernah dari body request.
function actor(req) {
  return { userId: req.user.id, companyId: req.user.currentCompanyId };
}

// Header SSE ditulis MALAS, saat emit pertama. Alasannya: begitu header terkirim, status HTTP
// tidak bisa diubah lagi -- setiap kegagalan setelah itu hanya bisa dilaporkan sebagai event di
// dalam stream yang sudah 200 OK. Rate limit, config hilang, dan company belum dipilih semuanya
// terjadi SEBELUM token pertama, jadi menunda header membuat semuanya tetap bisa dijawab dengan
// status yang benar (429/503/400) lewat errorHandler biasa.
function sseWriter(req, res) {
  let started = false;
  let closed = false;

  req.on('close', () => { closed = true; });

  return {
    get started() { return started; },
    emit(event, data) {
      if (closed) return;
      if (!started) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          // Nginx mem-buffer respons proxy secara default, yang menahan seluruh stream sampai
          // selesai dan membuat SSE tidak ada bedanya dengan JSON biasa (system.md §14 memakai
          // Nginx di depan). Header ini yang mematikannya.
          'X-Accel-Buffering': 'no',
        });
        started = true;
      }
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    end() {
      if (!closed && started) res.end();
    },
  };
}

const chat = asyncHandler(async (req, res) => {
  const body = chatSchema.parse(req.body);
  const stream = sseWriter(req, res);

  try {
    await assistantService.converse({
      ...actor(req),
      conversationId: body.conversation_id,
      message: body.message,
      locale: body.locale,
      route: body.route,
      emit: stream.emit,
      req,
    });
    stream.end();
  } catch (err) {
    // Stream sudah berjalan: status HTTP-nya terkunci di 200, jadi satu-satunya cara jujur
    // melaporkan kegagalan adalah sebagai event error lalu menutup stream.
    if (stream.started) {
      stream.emit('error', {
        code: err instanceof ApiError ? err.code : 'internal_error',
        message: err instanceof ApiError ? err.message : 'Unexpected server error',
      });
      stream.end();
      if (!(err instanceof ApiError)) console.error(err);
      return;
    }
    throw err;
  }
});

// Sengaja tidak melempar saat asisten mati: widget perlu tahu "mati" supaya bisa masuk mode
// degradasi (menu tautan modul), bukan menerima 503 dan menampilkan pesan error.
const getConfig = asyncHandler(async (req, res) => {
  let connectionId = null;
  try {
    const identity = await resolveIdentity(req.user.id, req.user.currentCompanyId);
    connectionId = identity.connection.id;
  } catch {
    // Belum memilih company, atau tidak punya identity mapping. Config global tetap bisa
    // dikembalikan -- widget hanya butuh tahu apakah ia boleh tampil.
  }
  res.json(await assistantConfigService.getClientConfig(connectionId, promptBuilder));
});

async function connectionIdFor(req) {
  const identity = await resolveIdentity(req.user.id, req.user.currentCompanyId);
  return identity.connection.id;
}

const listConversations = asyncHandler(async (req, res) => {
  const connectionId = await connectionIdFor(req);
  res.json(await assistantRepository.listConversations(req.user.id, connectionId));
});

const getConversation = asyncHandler(async (req, res) => {
  const connectionId = await connectionIdFor(req);
  const conversation = await assistantRepository.findConversation(req.params.id, req.user.id, connectionId);
  if (!conversation) throw new ApiError(404, 'not_found', 'Conversation not found');

  // Draf yang masih menunggu ikut dikembalikan supaya panel konfirmasi muncul lagi saat
  // percakapan lama dibuka -- tanpa ini, draf yang dibuat lalu ditinggal menjadi tidak terlihat
  // sampai kedaluwarsa, dan pengguna mengira asisten melupakannya.
  const [messages, drafts] = await Promise.all([
    assistantRepository.listMessages(conversation.id),
    assistantRepository.listPendingDrafts(conversation.id),
  ]);
  res.json({
    ...conversation,
    drafts: drafts.map((d) => ({
      draft_id: d.id, action: d.action, payload: d.payload, expires_at: d.expires_at,
    })),
    // Baris role 'tool' tidak dikirim ke klien sebagai pesan: yang berguna darinya hanya kartu,
    // dan tool_summary adalah teks yang ditulis untuk model, bukan untuk manusia.
    messages: messages
      .filter((m) => m.role !== 'tool')
      .map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        created_at: m.created_at,
        feedback_rating: m.feedback_rating,
      })),
    cards: messages
      .filter((m) => m.role === 'tool' && m.card_type)
      .map((m) => ({ type: m.card_type, ref: m.card_ref, created_at: m.created_at })),
  });
});

const deleteConversation = asyncHandler(async (req, res) => {
  const connectionId = await connectionIdFor(req);
  const deleted = await assistantRepository.deleteConversation(req.params.id, req.user.id, connectionId);
  if (!deleted) throw new ApiError(404, 'not_found', 'Conversation not found');

  await auditService.record(req, {
    action: 'assistant.conversation_deleted',
    targetType: 'assistant_conversation',
    targetId: req.params.id,
  });
  res.status(204).end();
});

// ------------------------------------------------------- aksi tulis (I-5) --
// Controller sengaja tipis di sini: seluruh urutan pemeriksaan hidup di draftService, supaya ia
// bisa diuji tanpa objek `req` (lihat scripts/check-assistant-flow.js). Yang tersisa di lapisan
// ini hanya hal yang memang butuh request: menurunkan connectionId dan mencatat audit.

const confirmDraft = asyncHandler(async (req, res) => {
  const connectionId = await connectionIdFor(req);
  const outcome = await draftService.confirm(req.user.id, req.user.currentCompanyId, connectionId, req.params.id);

  await auditService.record(req, {
    action: 'assistant.action',
    targetType: outcome.targetType,
    targetId: outcome.resultRef,
    metadata: { draftId: req.params.id, action: outcome.action },
  });
  res.status(201).json({
    action: outcome.action,
    result: outcome.result,
    label: outcome.label,
    deep_link: outcome.deepLink,
  });
});

const updateDraft = asyncHandler(async (req, res) => {
  const connectionId = await connectionIdFor(req);
  const updated = await draftService.update(req.user.id, req.user.currentCompanyId, connectionId, req.params.id, req.body);
  res.json({
    draft_id: updated.id, action: updated.action, payload: updated.payload, expires_at: updated.expires_at,
  });
});

const cancelDraft = asyncHandler(async (req, res) => {
  const connectionId = await connectionIdFor(req);
  const draft = await draftService.cancel(req.user.id, req.user.currentCompanyId, connectionId, req.params.id);

  await auditService.record(req, {
    action: 'assistant.draft_cancelled',
    targetType: 'assistant_action_draft',
    targetId: draft.id,
    metadata: { action: draft.action },
  });
  res.status(204).end();
});

const submitFeedback = asyncHandler(async (req, res) => {
  const body = feedbackSchema.parse(req.body);
  const connectionId = await connectionIdFor(req);

  // Kepemilikan diverifikasi lewat join ke percakapan, bukan hanya dengan id pesan: tanpa itu,
  // siapa pun yang punya id pesan orang lain bisa menilainya.
  const message = await assistantRepository.findMessageForUser(req.params.id, req.user.id, connectionId);
  if (!message) throw new ApiError(404, 'not_found', 'Message not found');

  const feedback = await assistantRepository.upsertFeedback({
    messageId: message.id,
    rating: body.rating,
    reason: body.reason,
  });
  await auditService.record(req, {
    action: 'assistant.feedback',
    targetType: 'assistant_message',
    targetId: message.id,
    metadata: { rating: body.rating },
  });
  res.json(feedback);
});

module.exports = {
  chat,
  getConfig,
  listConversations,
  getConversation,
  deleteConversation,
  confirmDraft,
  updateDraft,
  cancelDraft,
  submitFeedback,
};

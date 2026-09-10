const asyncHandler = require('../utils/asyncHandler');
const documentShareService = require('../services/documentShareService');
const auditService = require('../services/auditService');
const { shareSchema, searchSchema } = require('../validators/documentShareValidators');

// --- Sender (internal staff) ---

const searchRecipients = asyncHandler(async (req, res) => {
  const { q } = searchSchema.parse(req.query);
  res.json(await documentShareService.searchRecipients(req.user.id, req.user.currentCompanyId, q));
});

const share = asyncHandler(async (req, res) => {
  const body = shareSchema.parse(req.body);
  const result = await documentShareService.shareDocument(req.user.id, req.user.currentCompanyId, {
    recipientPartnerId: body.recipient_partner_id,
    file: req.file,
    category: body.category,
    note: body.note,
    expiresAt: body.expires_at,
  });
  // Accountability: record WHO shared WHAT to WHICH partner (with IP/user-agent via auditService).
  await auditService.record(req, {
    action: 'document.share',
    targetType: 'res.partner',
    targetId: String(body.recipient_partner_id),
    metadata: { document_share_id: result.id, filename: result.filename },
  });
  res.status(201).json(result);
});

const listSent = asyncHandler(async (req, res) => {
  res.json(await documentShareService.listSent(req.user.id, req.user.currentCompanyId));
});

const revoke = asyncHandler(async (req, res) => {
  const result = await documentShareService.revoke(req.user.id, req.params.id);
  await auditService.record(req, {
    action: 'document.revoke',
    targetType: 'document_share',
    targetId: req.params.id,
  });
  res.json(result);
});

// --- Recipient (customer) ---

const listInbox = asyncHandler(async (req, res) => {
  res.json(await documentShareService.listInbox(req.user.id, req.user.currentCompanyId));
});

const download = asyncHandler(async (req, res) => {
  const file = await documentShareService.download(req.user.id, req.user.currentCompanyId, req.params.id);
  // Accountability: only successful (in-scope) downloads reach here, so this is the access log.
  await auditService.record(req, {
    action: 'document.download',
    targetType: 'document_share',
    targetId: req.params.id,
    metadata: { filename: file.name },
  });
  res.set('Content-Type', file.mimetype);
  res.set('Content-Disposition', `attachment; filename="${file.name}"`);
  res.send(file.buffer);
});

module.exports = { searchRecipients, share, listSent, revoke, listInbox, download };

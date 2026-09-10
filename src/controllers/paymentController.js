const asyncHandler = require('../utils/asyncHandler');
const parseOdooId = require('../utils/parseOdooId');
const paymentService = require('../services/paymentService');
const auditService = require('../services/auditService');
const { uploadProofSchema } = require('../validators/paymentValidators');
const ApiError = require('../utils/ApiError');

const createLink = asyncHandler(async (req, res) => {
  const invoiceId = parseOdooId(req.params.id);
  const result = await paymentService.createPaymentLink(req.user.id, req.user.currentCompanyId, invoiceId);
  await auditService.record(req, { action: 'invoice.pay', targetType: 'account.move', targetId: String(invoiceId) });
  res.json(result);
});

const uploadProof = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'file_required', 'A proof file is required');
  const invoiceId = parseOdooId(req.params.id);
  const body = uploadProofSchema.parse(req.body);
  const proof = await paymentService.uploadProof(req.user.id, req.user.currentCompanyId, invoiceId, req.file, body.amount);
  await auditService.record(req, {
    action: 'invoice.payment_proof_upload',
    targetType: 'account.move',
    targetId: String(invoiceId),
  });
  res.status(201).json(proof);
});

const listProofs = asyncHandler(async (req, res) => {
  res.json(await paymentService.listProofs(req.user.id, req.user.currentCompanyId, parseOdooId(req.params.id)));
});

module.exports = { createLink, uploadProof, listProofs };

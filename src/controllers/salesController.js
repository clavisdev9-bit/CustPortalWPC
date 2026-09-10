const asyncHandler = require('../utils/asyncHandler');
const parseOdooId = require('../utils/parseOdooId');
const salesService = require('../services/salesService');
const auditService = require('../services/auditService');
const { rejectQuotationSchema, signQuotationSchema, postMessageSchema } = require('../validators/salesValidators');

const listQuotations = asyncHandler(async (req, res) => {
  res.json(await salesService.listQuotations(req.user.id, req.user.currentCompanyId));
});

const listOrders = asyncHandler(async (req, res) => {
  res.json(await salesService.listOrders(req.user.id, req.user.currentCompanyId));
});

const getOrder = asyncHandler(async (req, res) => {
  res.json(await salesService.getOrder(req.user.id, req.user.currentCompanyId, parseOdooId(req.params.id)));
});

const getOrderPdf = asyncHandler(async (req, res) => {
  const { filename, buffer } = await salesService.getOrderPdf(
    req.user.id,
    req.user.currentCompanyId,
    parseOdooId(req.params.id)
  );
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
});

const approveQuotation = asyncHandler(async (req, res) => {
  const order = await salesService.approveQuotation(req.user.id, req.user.currentCompanyId, parseOdooId(req.params.id));
  await auditService.record(req, { action: 'quotation.approve', targetType: 'sale.order', targetId: String(order.id) });
  res.json(order);
});

const rejectQuotation = asyncHandler(async (req, res) => {
  const body = rejectQuotationSchema.parse(req.body);
  const order = await salesService.rejectQuotation(
    req.user.id,
    req.user.currentCompanyId,
    parseOdooId(req.params.id),
    body.reason
  );
  await auditService.record(req, { action: 'quotation.reject', targetType: 'sale.order', targetId: String(order.id) });
  res.json(order);
});

const reorder = asyncHandler(async (req, res) => {
  const order = await salesService.reorder(req.user.id, req.user.currentCompanyId, parseOdooId(req.params.id));
  await auditService.record(req, { action: 'order.reorder', targetType: 'sale.order', targetId: String(order.id) });
  res.status(201).json(order);
});

const signQuotation = asyncHandler(async (req, res) => {
  const body = signQuotationSchema.parse(req.body);
  const order = await salesService.signQuotation(req.user.id, req.user.currentCompanyId, parseOdooId(req.params.id), {
    signatureBase64: body.signature,
    signedBy: body.signed_by,
  });
  await auditService.record(req, { action: 'quotation.sign', targetType: 'sale.order', targetId: String(order.id) });
  res.json(order);
});

const listOrderLines = asyncHandler(async (req, res) => {
  res.json(await salesService.listOrderLines(req.user.id, req.user.currentCompanyId, parseOdooId(req.params.id)));
});

const listMessages = asyncHandler(async (req, res) => {
  res.json(await salesService.listMessages(req.user.id, req.user.currentCompanyId, parseOdooId(req.params.id)));
});

// Factory (not a plain handler) because this same route shape is mounted under both
// /quotations/:id/messages and /orders/:id/messages, and the audit action name needs to reflect
// which resource the comment was posted on (see documentController.list/get for the same pattern).
const postMessage = (resourceType) =>
  asyncHandler(async (req, res) => {
    const body = postMessageSchema.parse(req.body);
    const orderId = parseOdooId(req.params.id);
    const messages = await salesService.postMessage(req.user.id, req.user.currentCompanyId, orderId, body.body);
    await auditService.record(req, {
      action: `${resourceType}.comment`,
      targetType: 'sale.order',
      targetId: String(orderId),
    });
    res.status(201).json(messages);
  });

module.exports = {
  listQuotations,
  listOrders,
  getOrder,
  getOrderPdf,
  approveQuotation,
  rejectQuotation,
  reorder,
  signQuotation,
  listOrderLines,
  listMessages,
  postMessage,
};

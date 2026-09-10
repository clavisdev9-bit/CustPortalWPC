const asyncHandler = require('../utils/asyncHandler');
const rmaService = require('../services/rmaService');
const auditService = require('../services/auditService');
const { createRmaSchema } = require('../validators/rmaValidators');

const list = asyncHandler(async (req, res) => {
  res.json(await rmaService.listRma(req.user.id, req.user.currentCompanyId));
});

const create = asyncHandler(async (req, res) => {
  const body = createRmaSchema.parse(req.body);
  const rma = await rmaService.createRma(req.user.id, req.user.currentCompanyId, {
    orderId: body.order_id,
    reason: body.reason,
    requestedAction: body.requested_action,
  });
  await auditService.record(req, { action: 'rma.create', targetType: 'rma_request', targetId: rma.id });
  res.status(201).json(rma);
});

const get = asyncHandler(async (req, res) => {
  res.json(await rmaService.getRma(req.user.id, req.user.currentCompanyId, req.params.id));
});

module.exports = { list, create, get };

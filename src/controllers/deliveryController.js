const asyncHandler = require('../utils/asyncHandler');
const parseOdooId = require('../utils/parseOdooId');
const deliveryService = require('../services/deliveryService');
const auditService = require('../services/auditService');
const { confirmDeliverySchema } = require('../validators/deliveryValidators');

const list = asyncHandler(async (req, res) => {
  res.json(await deliveryService.listDeliveries(req.user.id, req.user.currentCompanyId));
});

const get = asyncHandler(async (req, res) => {
  res.json(await deliveryService.getDelivery(req.user.id, req.user.currentCompanyId, parseOdooId(req.params.id)));
});

const tracking = asyncHandler(async (req, res) => {
  res.json(await deliveryService.getTracking(req.user.id, req.user.currentCompanyId, parseOdooId(req.params.id)));
});

const confirm = asyncHandler(async (req, res) => {
  const pickingId = parseOdooId(req.params.id);
  const body = confirmDeliverySchema.parse(req.body);
  const confirmation = await deliveryService.confirmDelivery(req.user.id, req.user.currentCompanyId, pickingId, {
    notes: body.notes,
    file: req.file,
  });
  await auditService.record(req, { action: 'delivery.confirm', targetType: 'stock.picking', targetId: String(pickingId) });
  res.status(201).json(confirmation);
});

module.exports = { list, get, tracking, confirm };

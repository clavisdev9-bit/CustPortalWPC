const asyncHandler = require('../utils/asyncHandler');
const customerRequestService = require('../services/customerRequestService');
const auditService = require('../services/auditService');
const { createRequestSchema } = require('../validators/customerRequestValidators');

const list = asyncHandler(async (req, res) => {
  res.json(await customerRequestService.listRequests(req.user.id, req.user.currentCompanyId));
});

const create = asyncHandler(async (req, res) => {
  const body = createRequestSchema.parse(req.body);
  const request = await customerRequestService.createRequest(req.user.id, req.user.currentCompanyId, body);
  // Only the "request_quotation" path actually mutates Odoo (creates a sale.order) -- audit that
  // the same way every other Odoo-mutating action does (salesController's approve/reject/reorder/
  // sign). "request_product" stays a portal-only record with nothing to audit against Odoo.
  if (request.payload?.odoo_order_id) {
    await auditService.record(req, {
      action: 'quotation.request_created',
      targetType: 'sale.order',
      targetId: String(request.payload.odoo_order_id),
    });
  }
  res.status(201).json(request);
});

module.exports = { list, create };

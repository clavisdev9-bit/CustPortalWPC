const asyncHandler = require('../utils/asyncHandler');
const warrantyService = require('../services/warrantyService');
const auditService = require('../services/auditService');
const { createWarrantyClaimSchema, lookupSerialQuerySchema } = require('../validators/warrantyValidators');

const list = asyncHandler(async (req, res) => {
  res.json(await warrantyService.listClaims(req.user.id, req.user.currentCompanyId));
});

const create = asyncHandler(async (req, res) => {
  const body = createWarrantyClaimSchema.parse(req.body);
  const claim = await warrantyService.createClaim(req.user.id, req.user.currentCompanyId, {
    serialNumber: body.serial_number,
    issueDescription: body.issue_description,
  });
  await auditService.record(req, { action: 'warranty.create', targetType: 'warranty_claim', targetId: claim.id });
  res.status(201).json(claim);
});

const get = asyncHandler(async (req, res) => {
  res.json(await warrantyService.getClaim(req.user.id, req.user.currentCompanyId, req.params.id));
});

const lookupSerial = asyncHandler(async (req, res) => {
  const query = lookupSerialQuerySchema.parse(req.query);
  res.json(await warrantyService.lookupSerial(req.user.id, req.user.currentCompanyId, query.serial));
});

module.exports = { list, create, get, lookupSerial };

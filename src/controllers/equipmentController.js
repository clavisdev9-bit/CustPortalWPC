const asyncHandler = require('../utils/asyncHandler');
const parseOdooId = require('../utils/parseOdooId');
const equipmentService = require('../services/equipmentService');
const equipmentRateLimiter = require('../services/equipmentRateLimiter');
const auditService = require('../services/auditService');
const { createCorrectionSchema } = require('../validators/equipmentValidators');

const list = asyncHandler(async (req, res) => {
  res.json(await equipmentService.listUnits(req.user.id, req.user.currentCompanyId));
});

const get = asyncHandler(async (req, res) => {
  res.json(await equipmentService.getUnit(req.user.id, req.user.currentCompanyId, parseOdooId(req.params.id)));
});

const parts = asyncHandler(async (req, res) => {
  res.json(await equipmentService.getPartsForUnit(req.user.id, req.user.currentCompanyId, parseOdooId(req.params.id)));
});

// §15.2: the most expensive endpoint this feature has -- checked before touching Odoo at all.
const dueReplacements = asyncHandler(async (req, res) => {
  equipmentRateLimiter.checkBurst(req.user.id);
  res.json(await equipmentService.getDueReplacements(req.user.id, req.user.currentCompanyId));
});

const serviceHistory = asyncHandler(async (req, res) => {
  res.json(await equipmentService.getServiceHistory(req.user.id, req.user.currentCompanyId, parseOdooId(req.params.id)));
});

const listCorrections = asyncHandler(async (req, res) => {
  res.json(await equipmentService.listCorrections(req.user.id, req.user.currentCompanyId));
});

const createCorrection = asyncHandler(async (req, res) => {
  const body = createCorrectionSchema.parse(req.body);
  const correction = await equipmentService.createCorrection(req.user.id, req.user.currentCompanyId, body.equipment_id, {
    correctionType: body.correction_type,
    proposedValue: body.proposed_value,
    note: body.note,
  });
  await auditService.record(req, { action: 'equipment.correct', targetType: 'equipment_correction', targetId: correction.id });
  res.status(201).json(correction);
});

module.exports = { list, get, parts, dueReplacements, serviceHistory, listCorrections, createCorrection };

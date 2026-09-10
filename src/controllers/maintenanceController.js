const asyncHandler = require('../utils/asyncHandler');
const parseOdooId = require('../utils/parseOdooId');
const maintenanceService = require('../services/maintenanceService');

const list = asyncHandler(async (req, res) => {
  res.json(await maintenanceService.listRequests(req.user.id, req.user.currentCompanyId));
});

const get = asyncHandler(async (req, res) => {
  res.json(await maintenanceService.getRequest(req.user.id, req.user.currentCompanyId, parseOdooId(req.params.id)));
});

module.exports = { list, get };

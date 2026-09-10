const asyncHandler = require('../utils/asyncHandler');
const dashboardService = require('../services/dashboardService');

const summary = asyncHandler(async (req, res) => {
  res.json(await dashboardService.getSummary(req.user.id, req.user.currentCompanyId));
});

module.exports = { summary };

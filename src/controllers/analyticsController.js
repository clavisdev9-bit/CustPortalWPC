const asyncHandler = require('../utils/asyncHandler');
const analyticsService = require('../services/analyticsService');

const spendingTrend = asyncHandler(async (req, res) => {
  res.json(await analyticsService.getSpendingTrend(req.user.id, req.user.currentCompanyId));
});

const orderVolumeTrend = asyncHandler(async (req, res) => {
  res.json(await analyticsService.getOrderVolumeTrend(req.user.id, req.user.currentCompanyId));
});

module.exports = { spendingTrend, orderVolumeTrend };

const { resolveOdooContext } = require('./odooContext');
const OdooAnalyticsService = require('../integrations/odoo/OdooAnalyticsService');

async function getSpendingTrend(userId, currentCompanyId) {
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId);
  return OdooAnalyticsService.getSpendingTrend(session, odooPartnerId, odooCompanyId);
}

async function getOrderVolumeTrend(userId, currentCompanyId) {
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId);
  return OdooAnalyticsService.getOrderVolumeTrend(session, odooPartnerId, odooCompanyId);
}

module.exports = { getSpendingTrend, getOrderVolumeTrend };

const { resolveOdooContext } = require('./odooContext');
const OdooMaintenanceService = require('../integrations/odoo/OdooMaintenanceService');

async function listRequests(userId, currentCompanyId) {
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId, { feature: 'maintenance' });
  return OdooMaintenanceService.listRequests(session, odooPartnerId, odooCompanyId);
}

async function getRequest(userId, currentCompanyId, requestId) {
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId, { feature: 'maintenance' });
  return OdooMaintenanceService.getRequest(session, odooPartnerId, odooCompanyId, requestId);
}

module.exports = { listRequests, getRequest };

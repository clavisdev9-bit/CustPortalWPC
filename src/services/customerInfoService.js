const { resolveOdooContext } = require('./odooContext');
const OdooCustomerInfoService = require('../integrations/odoo/OdooCustomerInfoService');

async function getProfile(userId, currentCompanyId) {
  const { session, odooPartnerId } = await resolveOdooContext(userId, currentCompanyId);
  return OdooCustomerInfoService.getProfile(session, odooPartnerId);
}

async function listAddresses(userId, currentCompanyId) {
  const { session, odooPartnerId } = await resolveOdooContext(userId, currentCompanyId);
  return OdooCustomerInfoService.listAddresses(session, odooPartnerId);
}

async function listContacts(userId, currentCompanyId) {
  const { session, odooPartnerId } = await resolveOdooContext(userId, currentCompanyId);
  return OdooCustomerInfoService.listContacts(session, odooPartnerId);
}

module.exports = { getProfile, listAddresses, listContacts };

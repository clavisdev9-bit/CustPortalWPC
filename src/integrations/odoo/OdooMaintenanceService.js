const ApiError = require('../../utils/ApiError');

// maintenance.request has no partner_id -- this Odoo instance links a request to the customer
// via a Studio-added field instead (CR: "Schedule Maintenance"). Assumed Many2one to res.partner,
// same identity every other service compares against (resolveOdooContext's odooPartnerId).
const CUSTOMER_FIELD = 'x_studio_customer';

// company_id on maintenance.request is a related/stored field sourced from equipment_id.company_id
// (added for multi-company filtering) -- kept here to match the mandatory partner+company lock
// used by every other Odoo*Service (CLAUDE.md rule 2). Unverified against this specific instance;
// if it 404s everything, drop the company_id leg below and re-check live via fields_get.
function baseDomain(partnerId, companyId) {
  return [
    [CUSTOMER_FIELD, '=', partnerId],
    ['company_id', '=', companyId],
  ];
}

const LIST_FIELDS = [
  'id',
  'name',
  'schedule_date',
  'duration',
  'maintenance_type',
  'priority',
  'stage_id',
  'equipment_id',
  'description',
  'close_date',
];

function listRequests(session, partnerId, companyId) {
  return session.searchRead('maintenance.request', baseDomain(partnerId, companyId), LIST_FIELDS, {
    order: 'schedule_date asc',
  });
}

// Same rule as every other Odoo-backed service: filter by the customer lock + company_id even on
// a single id, so a request belonging to another customer 404s instead of ever being read.
async function getRequest(session, partnerId, companyId, requestId) {
  const [request] = await session.searchRead(
    'maintenance.request',
    [...baseDomain(partnerId, companyId), ['id', '=', requestId]],
    LIST_FIELDS
  );
  if (!request) throw new ApiError(404, 'not_found', 'Maintenance request not found');
  return request;
}

module.exports = { listRequests, getRequest };

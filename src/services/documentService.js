const { resolveOdooContext } = require('./odooContext');
const OdooSalesService = require('../integrations/odoo/OdooSalesService');
const OdooInvoiceService = require('../integrations/odoo/OdooInvoiceService');
const OdooDeliveryService = require('../integrations/odoo/OdooDeliveryService');
const OdooHelpdeskService = require('../integrations/odoo/OdooHelpdeskService');
const OdooSubscriptionService = require('../integrations/odoo/OdooSubscriptionService');
const OdooAttachmentService = require('../integrations/odoo/OdooAttachmentService');
const ApiError = require('../utils/ApiError');

// Every entry reuses the owning feature's own ensure-ownership getter before touching
// ir.attachment -- documents are always a sub-resource of a record the caller already proved
// they own, never a freestanding "give me any attachment by id" endpoint (section 22).
const RESOURCE_MAP = {
  quotations: { model: 'sale.order', ensure: OdooSalesService.getOrder },
  orders: { model: 'sale.order', ensure: OdooSalesService.getOrder },
  invoices: { model: 'account.move', ensure: OdooInvoiceService.getInvoice },
  deliveries: { model: 'stock.picking', ensure: OdooDeliveryService.getDelivery },
  tickets: { model: 'helpdesk.ticket', ensure: OdooHelpdeskService.getTicket },
  subscriptions: { model: 'sale.order', ensure: OdooSubscriptionService.getSubscription },
};

function resolveResource(resourceType) {
  const resource = RESOURCE_MAP[resourceType];
  if (!resource) throw new ApiError(404, 'not_found', 'Unknown document resource type');
  return resource;
}

async function listDocuments(userId, currentCompanyId, resourceType, resourceId) {
  const resource = resolveResource(resourceType);
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId);
  await resource.ensure(session, odooPartnerId, odooCompanyId, resourceId);
  return OdooAttachmentService.listForRecord(session, resource.model, resourceId);
}

async function getDocument(userId, currentCompanyId, resourceType, resourceId, attachmentId) {
  const resource = resolveResource(resourceType);
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId);
  await resource.ensure(session, odooPartnerId, odooCompanyId, resourceId);
  return OdooAttachmentService.getContent(session, resource.model, resourceId, attachmentId);
}

module.exports = { listDocuments, getDocument };

const customerRequestRepository = require('../repositories/customerRequestRepository');
const { resolveIdentity } = require('./odooContext');
const salesService = require('./salesService');
const notificationService = require('./notificationService');

// "Request Product" (an item that doesn't exist in the catalog at all) has no Odoo model to map
// onto, so it stays a portal-only record -- Sales follows up manually, per section 13.
//
// "Request Quotation" used to be portal-only too, which was the root cause of BUG-14: customers
// submitted a request and nothing ever appeared in Odoo, because createRequest() never called
// Odoo at all for either type. That made sense back when a request was just a free-text note
// (BUG-12 -- section 13 never specified which Odoo model/fields a freeform ask should become).
// It stopped making sense once the "Request quotation" form started collecting real
// product_id/qty lines straight from the live catalog (GET /products, same Odoo connection) --
// at that point the model/field mapping is no longer ambiguous, it's just sale.order +
// sale.order.line. So this now actually creates that draft quotation in Odoo (salesService.
// createQuotationRequest) BEFORE writing the local audit-trail row, and lets a failure (e.g.
// Odoo unreachable) fail the whole request rather than silently recording a "submitted" request
// that -- like before -- corresponds to nothing in Odoo. See resolution.md BUG-14.
async function createRequest(userId, currentCompanyId, { type, payload }) {
  let connectionId;
  let storedPayload = payload;
  let notifTitle = 'Product request submitted';
  let notifLink = '/requests';

  if (type === 'request_quotation') {
    // createQuotationRequest() already resolves identity/session internally (it has to, to open
    // the Odoo session) -- reuse its connectionId instead of calling resolveIdentity again here,
    // which would otherwise re-run the same DB lookups and open a second, unused Odoo session.
    const { order, connectionId: cid } = await salesService.createQuotationRequest(userId, currentCompanyId, {
      lines: payload.lines,
      note: payload.note,
    });
    connectionId = cid;
    storedPayload = { ...payload, odoo_order_id: order.id, odoo_order_name: order.name };
    notifTitle = `Quotation ${order.name} created from your request`;
    notifLink = '/quotations';
  } else {
    const { connection } = await resolveIdentity(userId, currentCompanyId);
    connectionId = connection.id;
  }

  const request = await customerRequestRepository.create({
    portalUserId: userId,
    odooConnectionId: connectionId,
    type,
    payload: storedPayload,
  });

  // Best-effort: the quotation (or portal request) itself already stands at this point, so a
  // notification failure shouldn't turn a successful submission into an error response -- same
  // pattern as deliveryService/paymentService's post-write notify() calls.
  notificationService
    .notify(userId, { type: 'customer_request.created', title: notifTitle, link: notifLink })
    .catch((err) => console.error('Failed to record customer-request notification:', err.message));

  return request;
}

async function listRequests(userId, currentCompanyId) {
  const { connection } = await resolveIdentity(userId, currentCompanyId);
  return customerRequestRepository.listForUser(userId, connection.id);
}

module.exports = { createRequest, listRequests };

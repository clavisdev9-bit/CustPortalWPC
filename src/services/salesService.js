const { resolveOdooContext } = require('./odooContext');
const OdooSalesService = require('../integrations/odoo/OdooSalesService');
const notificationService = require('./notificationService');

async function listQuotations(userId, currentCompanyId) {
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId);
  return OdooSalesService.listQuotations(session, odooPartnerId, odooCompanyId);
}

async function listOrders(userId, currentCompanyId) {
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId);
  return OdooSalesService.listOrders(session, odooPartnerId, odooCompanyId);
}

async function getOrder(userId, currentCompanyId, orderId) {
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId);
  return OdooSalesService.getOrder(session, odooPartnerId, odooCompanyId, orderId);
}

async function getOrderPdf(userId, currentCompanyId, orderId) {
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId);
  return OdooSalesService.getOrderPdf(session, odooPartnerId, odooCompanyId, orderId);
}

async function approveQuotation(userId, currentCompanyId, orderId) {
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId);
  const order = await OdooSalesService.approveQuotation(session, odooPartnerId, odooCompanyId, orderId);
  await notificationService.notify(userId, {
    type: 'quotation.approved',
    title: `Quotation ${order.name} approved`,
    link: `/orders/${order.id}`,
  });
  return order;
}

async function rejectQuotation(userId, currentCompanyId, orderId, reason) {
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId);
  const order = await OdooSalesService.rejectQuotation(session, odooPartnerId, odooCompanyId, orderId, reason);
  await notificationService.notify(userId, {
    type: 'quotation.rejected',
    title: `Quotation ${order.name} rejected`,
    body: reason || null,
    link: `/quotations/${order.id}`,
  });
  return order;
}

async function reorder(userId, currentCompanyId, orderId) {
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId);
  const newOrder = await OdooSalesService.reorder(session, odooPartnerId, odooCompanyId, orderId);
  await notificationService.notify(userId, {
    type: 'order.reordered',
    title: `Reorder created: ${newOrder.name}`,
    link: `/quotations/${newOrder.id}`,
  });
  return newOrder;
}

async function signQuotation(userId, currentCompanyId, orderId, { signatureBase64, signedBy }) {
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId);
  const order = await OdooSalesService.signQuotation(session, odooPartnerId, odooCompanyId, orderId, {
    signatureBase64,
    signedBy,
  });
  await notificationService.notify(userId, {
    type: 'quotation.signed',
    title: `Quotation ${order.name} signed and confirmed`,
    link: `/orders/${order.id}`,
  });
  return order;
}

// Returns connectionId alongside the created order so callers that also need to stamp a local
// row with odoo_connection_id (customerRequestService) don't have to call resolveOdooContext
// (DB lookups + a second Odoo login) a second time just to get it.
async function createQuotationRequest(userId, currentCompanyId, { lines, note }) {
  const { session, connectionId, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId);
  const order = await OdooSalesService.createQuotation(session, odooPartnerId, odooCompanyId, lines, note);
  return { order, connectionId };
}

async function listOrderLines(userId, currentCompanyId, orderId) {
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId);
  return OdooSalesService.listOrderLines(session, odooPartnerId, odooCompanyId, orderId);
}

async function listMessages(userId, currentCompanyId, orderId) {
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId);
  return OdooSalesService.listMessages(session, odooPartnerId, odooCompanyId, orderId);
}

async function postMessage(userId, currentCompanyId, orderId, body) {
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId);
  return OdooSalesService.postMessage(session, odooPartnerId, odooCompanyId, orderId, body);
}

module.exports = {
  listQuotations,
  listOrders,
  getOrder,
  getOrderPdf,
  approveQuotation,
  rejectQuotation,
  reorder,
  signQuotation,
  createQuotationRequest,
  listOrderLines,
  listMessages,
  postMessage,
};

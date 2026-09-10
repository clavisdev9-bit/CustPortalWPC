const { resolveOdooContext } = require('./odooContext');
const OdooInvoiceService = require('../integrations/odoo/OdooInvoiceService');
const OdooAttachmentService = require('../integrations/odoo/OdooAttachmentService');
const ApiError = require('../utils/ApiError');

async function listInvoices(userId, currentCompanyId) {
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId);
  return OdooInvoiceService.listInvoices(session, odooPartnerId, odooCompanyId);
}

async function getInvoice(userId, currentCompanyId, invoiceId) {
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId);
  return OdooInvoiceService.getInvoice(session, odooPartnerId, odooCompanyId, invoiceId);
}

async function getOutstanding(userId, currentCompanyId) {
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId);
  return OdooInvoiceService.getOutstanding(session, odooPartnerId, odooCompanyId);
}

// Downloads the most recently attached PDF rather than regenerating a report live -- Odoo
// normally auto-attaches the PDF when an invoice is posted/sent, and reproducing its
// report-rendering pipeline over XML-RPC is fragile across versions.
async function getInvoicePdf(userId, currentCompanyId, invoiceId) {
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId);
  await OdooInvoiceService.getInvoice(session, odooPartnerId, odooCompanyId, invoiceId);
  const attachments = await OdooAttachmentService.listForRecord(session, 'account.move', invoiceId);
  const pdf = attachments.find((a) => a.mimetype === 'application/pdf') || attachments[0];
  if (!pdf) throw new ApiError(404, 'not_found', 'No PDF has been generated for this invoice in Odoo yet');
  return OdooAttachmentService.getContent(session, 'account.move', invoiceId, pdf.id);
}

module.exports = { listInvoices, getInvoice, getOutstanding, getInvoicePdf };

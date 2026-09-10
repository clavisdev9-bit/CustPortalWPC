const ApiError = require('../../utils/ApiError');

const LIST_FIELDS = [
  'id',
  'name',
  'invoice_date',
  'invoice_date_due',
  'amount_total',
  'amount_residual',
  'currency_id',
  'state',
  'payment_state',
];

function baseDomain(partnerId, companyId) {
  return [
    ['partner_id', '=', partnerId],
    ['company_id', '=', companyId],
    ['move_type', '=', 'out_invoice'],
    ['state', '=', 'posted'],
  ];
}

function listInvoices(session, partnerId, companyId) {
  return session.searchRead('account.move', baseDomain(partnerId, companyId), LIST_FIELDS, { order: 'invoice_date desc' });
}

async function getInvoice(session, partnerId, companyId, invoiceId) {
  const [invoice] = await session.searchRead(
    'account.move',
    [...baseDomain(partnerId, companyId), ['id', '=', invoiceId]],
    LIST_FIELDS
  );
  if (!invoice) throw new ApiError(404, 'not_found', 'Invoice not found');
  return invoice;
}

async function getOutstanding(session, partnerId, companyId) {
  const invoices = await session.searchRead(
    'account.move',
    [...baseDomain(partnerId, companyId), ['payment_state', 'in', ['not_paid', 'partial']]],
    ['amount_residual', 'currency_id']
  );
  const total = invoices.reduce((sum, inv) => sum + inv.amount_residual, 0);
  return { total, count: invoices.length, currency: invoices[0]?.currency_id?.[1] || null };
}

module.exports = { listInvoices, getInvoice, getOutstanding };

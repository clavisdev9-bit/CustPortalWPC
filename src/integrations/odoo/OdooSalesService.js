const ApiError = require('../../utils/ApiError');

const QUOTATION_STATES = ['draft', 'sent'];
const ORDER_STATES = ['sale', 'done'];
const LIST_FIELDS = ['id', 'name', 'date_order', 'amount_total', 'currency_id', 'state', 'invoice_status', 'validity_date'];
const LINE_FIELDS = [
  'id',
  'product_id',
  'name',
  'product_uom_qty',
  'product_uom',
  'price_unit',
  'price_subtotal',
  'price_tax',
  'price_total',
  'tax_id',
];
const MESSAGE_FIELDS = ['id', 'author_id', 'body', 'date', 'message_type'];

function baseDomain(partnerId, companyId) {
  return [
    ['partner_id', '=', partnerId],
    ['company_id', '=', companyId],
  ];
}

// Every read/action below re-filters by partner_id + company_id, including on a single id --
// a sale.order belonging to another customer simply won't match the domain, so it 404s instead
// of ever being fetched (section 22).
async function ensureOwned(session, partnerId, companyId, orderId) {
  const [order] = await session.searchRead(
    'sale.order',
    [...baseDomain(partnerId, companyId), ['id', '=', orderId]],
    LIST_FIELDS
  );
  if (!order) throw new ApiError(404, 'not_found', 'Sales order not found');
  return order;
}

function listQuotations(session, partnerId, companyId) {
  return session.searchRead(
    'sale.order',
    [...baseDomain(partnerId, companyId), ['state', 'in', QUOTATION_STATES]],
    LIST_FIELDS,
    { order: 'date_order desc' }
  );
}

function listOrders(session, partnerId, companyId) {
  return session.searchRead(
    'sale.order',
    [...baseDomain(partnerId, companyId), ['state', 'in', ORDER_STATES]],
    LIST_FIELDS,
    { order: 'date_order desc' }
  );
}

function getOrder(session, partnerId, companyId, orderId) {
  return ensureOwned(session, partnerId, companyId, orderId);
}

// 'sale.report_saleorder' is the one QWeb report Odoo uses for both quotations and confirmed
// orders (same sale.order form, just a different state) -- same PDF a customer would get from
// Odoo's own portal "Print" button. ensureOwned() re-runs the same partner_id/company_id domain
// check every other endpoint here uses before any Odoo report call is made.
const SALE_ORDER_REPORT_REF = 'sale.report_saleorder';

async function getOrderPdf(session, partnerId, companyId, orderId) {
  const order = await ensureOwned(session, partnerId, companyId, orderId);
  const buffer = await session.getReportPdf(SALE_ORDER_REPORT_REF, [orderId]);
  return { filename: `${order.name}.pdf`, buffer };
}

async function approveQuotation(session, partnerId, companyId, orderId) {
  await ensureOwned(session, partnerId, companyId, orderId);
  await session.callMethod('sale.order', 'action_confirm', [orderId]);
  return ensureOwned(session, partnerId, companyId, orderId);
}

// Odoo has no universal "customer rejected" state on sale.order without a custom module, so this
// records the rejection as a chatter note (visible to the sales team in Odoo) rather than forcing
// a state transition that could vary by version. Confirm this matches how the target Odoo's own
// portal decline behaves before treating it as equivalent.
async function rejectQuotation(session, partnerId, companyId, orderId, reason) {
  await ensureOwned(session, partnerId, companyId, orderId);
  await session.callMethod('sale.order', 'message_post', [orderId], [], {
    body: `Quotation rejected by customer via portal.${reason ? ` Reason: ${reason}` : ''}`,
  });
  return ensureOwned(session, partnerId, companyId, orderId);
}

// sale.order.copy() is Odoo's own "duplicate this order" method -- reordering means asking Odoo
// to create the new draft with current price/stock rules applied, not resubmitting stale line data.
async function reorder(session, partnerId, companyId, orderId) {
  await ensureOwned(session, partnerId, companyId, orderId);
  const newId = await session.callMethod('sale.order', 'copy', [orderId]);
  return ensureOwned(session, partnerId, companyId, newId);
}

// Writes to sale.order's own signature/signed_by/signed_on fields -- the same fields Odoo's
// built-in customer portal uses for "Accept & Sign" (native since Odoo 12's portal, no separate
// Sign app / sign.request needed). Signing is the acceptance action, so it also confirms the
// order, same as approveQuotation. Confirm these fields still exist on the target Odoo version.
async function signQuotation(session, partnerId, companyId, orderId, { signatureBase64, signedBy }) {
  await ensureOwned(session, partnerId, companyId, orderId);
  await session.write('sale.order', [orderId], {
    signature: signatureBase64,
    signed_by: signedBy,
    signed_on: new Date().toISOString().slice(0, 19).replace('T', ' '),
  });
  try {
    await session.callMethod('sale.order', 'action_confirm', [orderId]);
  } catch (err) {
    // Confirmed live: Odoo can reject action_confirm for reasons unrelated to the signature
    // itself (e.g. "a line is missing a product") -- the write() above already committed as its
    // own transaction, so a signed-but-unconfirmed order would otherwise be left behind. Clear
    // it back out (Odoo's XML-RPC empty-value sentinel is `false`, not null/undefined) rather
    // than silently keeping a signature on an order that was never actually accepted.
    await session
      .write('sale.order', [orderId], { signature: false, signed_by: false, signed_on: false })
      .catch(() => {});
    throw err;
  }
  return ensureOwned(session, partnerId, companyId, orderId);
}

// Creates a real draft sale.order (quotation) from the portal's "Request quotation" form.
// Each line's product_id comes straight from the live catalog (GET /products, itself backed by
// this same Odoo connection), so -- unlike the freeform "Request product" ask -- there is no
// ambiguity about which Odoo model/fields this maps onto (see resolution.md BUG-12/BUG-14):
// it's just sale.order + sale.order.line, created the same way the ORM computes them for any
// other create() call (price_unit/name/tax_id are stored computed fields, so they populate from
// product_id without needing to replicate the web client's onchange dance -- confirmed live
// against the same pattern already used by reorder()'s sale.order.copy()).
async function createQuotation(session, partnerId, companyId, lines, note) {
  const orderId = await session.create('sale.order', {
    partner_id: partnerId,
    company_id: companyId,
    order_line: lines.map((line) => [0, 0, { product_id: line.product_id, product_uom_qty: line.qty }]),
  });
  // The chatter note and the final read-back both only need orderId -- neither depends on the
  // other's result -- so they run concurrently instead of as two sequential RPC round-trips.
  const [order] = await Promise.all([
    ensureOwned(session, partnerId, companyId, orderId),
    note
      ? session.callMethod('sale.order', 'message_post', [orderId], [], {
          body: `Quotation requested by customer via portal. Note: ${note}`,
        })
      : Promise.resolve(),
  ]);
  return order;
}

// sale.order.line rows for the "Products" breakdown -- a separate call rather than folded into
// LIST_FIELDS so the list view (which never shows line items) doesn't pay for a nested read on
// every quotation, only the one the customer expands.
async function listOrderLines(session, partnerId, companyId, orderId) {
  await ensureOwned(session, partnerId, companyId, orderId);
  const lines = await session.searchRead('sale.order.line', [['order_id', '=', orderId]], LINE_FIELDS, { order: 'id asc' });

  // tax_id is many2many, so search_read gives back bare ids (unlike the [id, display_name] pairs
  // many2one fields like product_id get) -- one extra batched lookup resolves them all to names
  // instead of a per-line round trip.
  const taxIds = [...new Set(lines.flatMap((line) => line.tax_id || []))];
  const taxNames = taxIds.length ? await session.searchRead('account.tax', [['id', 'in', taxIds]], ['id', 'name']) : [];
  const taxNameById = new Map(taxNames.map((t) => [t.id, t.name]));

  return lines.map((line) => ({
    ...line,
    taxes: (line.tax_id || []).map((id) => taxNameById.get(id)).filter(Boolean),
  }));
}

// Reads sale.order's own chatter (mail.message) rather than a portal-specific endpoint --
// filtered to is_internal=false so internal sales-team notes never leak to the customer.
// The FK back to the parent record is named `model` on mail.message (unlike `res_model` on
// ir.attachment, which is a different model with its own field naming) -- confirmed live against
// the target Odoo 18 instance via fields_get (`res_model` doesn't exist on mail.message at all;
// using it throws "Invalid field mail.message.res_model" rather than returning no rows).
// `is_internal` also confirmed to exist there (added Odoo 16+).
async function listMessages(session, partnerId, companyId, orderId) {
  await ensureOwned(session, partnerId, companyId, orderId);
  return session.searchRead(
    'mail.message',
    [
      ['model', '=', 'sale.order'],
      ['res_id', '=', orderId],
      ['is_internal', '=', false],
      ['message_type', 'in', ['comment', 'notification', 'email']],
    ],
    MESSAGE_FIELDS,
    { order: 'date asc' }
  );
}

// Posts a customer comment onto the same chatter thread rejectQuotation already writes notes to
// (message_post), then re-reads the thread so the caller gets it back with the new entry included.
async function postMessage(session, partnerId, companyId, orderId, body) {
  await ensureOwned(session, partnerId, companyId, orderId);
  await session.callMethod('sale.order', 'message_post', [orderId], [], { body, message_type: 'comment' });
  return listMessages(session, partnerId, companyId, orderId);
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
  createQuotation,
  listOrderLines,
  listMessages,
  postMessage,
};

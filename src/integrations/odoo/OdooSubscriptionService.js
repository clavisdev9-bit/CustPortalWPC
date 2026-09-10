const ApiError = require('../../utils/ApiError');

const LIST_FIELDS = [
  'id',
  'name',
  'amount_total',
  'currency_id',
  'state',
  'subscription_state',
  'start_date',
  'next_invoice_date',
  'end_date',
];

// Field names here (is_subscription, subscription_state, next_invoice_date) match Odoo 17/18's
// Sales-app-integrated Subscriptions. Earlier versions used a separate sale.subscription model
// with entirely different field names -- verify against the target Odoo version.
function baseDomain(partnerId, companyId) {
  return [
    ['partner_id', '=', partnerId],
    ['company_id', '=', companyId],
    ['is_subscription', '=', true],
  ];
}

async function ensureOwned(session, partnerId, companyId, orderId) {
  const [sub] = await session.searchRead(
    'sale.order',
    [...baseDomain(partnerId, companyId), ['id', '=', orderId]],
    LIST_FIELDS
  );
  if (!sub) throw new ApiError(404, 'not_found', 'Subscription not found');
  return sub;
}

function listSubscriptions(session, partnerId, companyId) {
  return session.searchRead('sale.order', baseDomain(partnerId, companyId), LIST_FIELDS, {
    order: 'next_invoice_date asc',
  });
}

function getSubscription(session, partnerId, companyId, orderId) {
  return ensureOwned(session, partnerId, companyId, orderId);
}

const ACTION_LABELS = { renew: 'Renew', upgrade: 'Upgrade', downgrade: 'Downgrade', close: 'Close' };

// Section 19: "Portal hanya menyediakan customer interaction" -- recurring billing and the
// actual renew/upgrade/downgrade/close mutation stay in Odoo. This records the request as a
// chatter note (visible to the account team) rather than calling a version-specific
// subscription-mutation method directly against a live recurring contract -- getting that wrong
// has real billing consequences, unlike a quotation rejection.
async function requestAction(session, partnerId, companyId, orderId, action, note) {
  const sub = await ensureOwned(session, partnerId, companyId, orderId);
  await session.callMethod('sale.order', 'message_post', [orderId], [], {
    body: `Customer requested "${ACTION_LABELS[action]}" on subscription via portal.${note ? ` Note: ${note}` : ''}`,
  });
  return sub;
}

module.exports = { listSubscriptions, getSubscription, requestAction };

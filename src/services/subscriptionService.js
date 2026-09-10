const { resolveOdooContext } = require('./odooContext');
const OdooSubscriptionService = require('../integrations/odoo/OdooSubscriptionService');
const notificationService = require('./notificationService');

async function listSubscriptions(userId, currentCompanyId) {
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId, { feature: 'subscriptions' });
  return OdooSubscriptionService.listSubscriptions(session, odooPartnerId, odooCompanyId);
}

async function getSubscription(userId, currentCompanyId, orderId) {
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId, { feature: 'subscriptions' });
  return OdooSubscriptionService.getSubscription(session, odooPartnerId, odooCompanyId, orderId);
}

async function requestAction(userId, currentCompanyId, orderId, action, note) {
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId, { feature: 'subscriptions' });
  const sub = await OdooSubscriptionService.requestAction(session, odooPartnerId, odooCompanyId, orderId, action, note);
  await notificationService
    .notify(userId, {
      type: `subscription.${action}_requested`,
      title: `${action[0].toUpperCase()}${action.slice(1)} requested for ${sub.name}`,
      link: `/subscriptions/${sub.id}`,
    })
    .catch((err) => console.error('Failed to record subscription-action notification:', err.message));
  return sub;
}

module.exports = { listSubscriptions, getSubscription, requestAction };

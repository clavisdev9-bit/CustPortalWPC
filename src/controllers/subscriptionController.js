const asyncHandler = require('../utils/asyncHandler');
const parseOdooId = require('../utils/parseOdooId');
const subscriptionService = require('../services/subscriptionService');
const auditService = require('../services/auditService');
const { requestActionSchema } = require('../validators/subscriptionValidators');

const list = asyncHandler(async (req, res) => {
  res.json(await subscriptionService.listSubscriptions(req.user.id, req.user.currentCompanyId));
});

const get = asyncHandler(async (req, res) => {
  res.json(
    await subscriptionService.getSubscription(req.user.id, req.user.currentCompanyId, parseOdooId(req.params.id))
  );
});

function actionHandler(action) {
  return asyncHandler(async (req, res) => {
    const body = requestActionSchema.parse(req.body);
    const orderId = parseOdooId(req.params.id);
    const sub = await subscriptionService.requestAction(req.user.id, req.user.currentCompanyId, orderId, action, body.note);
    await auditService.record(req, {
      action: `subscription.${action}_request`,
      targetType: 'sale.order',
      targetId: String(orderId),
    });
    res.json(sub);
  });
}

module.exports = {
  list,
  get,
  renew: actionHandler('renew'),
  upgrade: actionHandler('upgrade'),
  downgrade: actionHandler('downgrade'),
  close: actionHandler('close'),
};

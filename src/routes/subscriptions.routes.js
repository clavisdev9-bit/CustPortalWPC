const { Router } = require('express');
const controller = require('../controllers/subscriptionController');
const documentController = require('../controllers/documentController');
const { authenticate } = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('subscription.view'), controller.list);
router.get('/:id', requirePermission('subscription.view'), controller.get);
router.post('/:id/renew', requirePermission('subscription.manage'), controller.renew);
router.post('/:id/upgrade', requirePermission('subscription.manage'), controller.upgrade);
router.post('/:id/downgrade', requirePermission('subscription.manage'), controller.downgrade);
router.post('/:id/close', requirePermission('subscription.manage'), controller.close);
router.get('/:id/documents', requirePermission('subscription.view'), documentController.list('subscriptions'));
router.get(
  '/:id/documents/:attachmentId',
  requirePermission('subscription.view'),
  documentController.get('subscriptions')
);

module.exports = router;

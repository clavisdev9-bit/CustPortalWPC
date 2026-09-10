const { Router } = require('express');
const controller = require('../controllers/salesController');
const documentController = require('../controllers/documentController');
const { authenticate } = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('order.view'), controller.listOrders);
router.get('/:id', requirePermission('order.view'), controller.getOrder);
router.get('/:id/pdf', requirePermission('order.view'), controller.getOrderPdf);
router.post('/:id/reorder', requirePermission('order.reorder'), controller.reorder);
router.get('/:id/lines', requirePermission('order.view'), controller.listOrderLines);
router.get('/:id/messages', requirePermission('order.view'), controller.listMessages);
router.post('/:id/messages', requirePermission('order.comment'), controller.postMessage('order'));
router.get('/:id/documents', requirePermission('order.view'), documentController.list('orders'));
router.get('/:id/documents/:attachmentId', requirePermission('order.view'), documentController.get('orders'));

module.exports = router;

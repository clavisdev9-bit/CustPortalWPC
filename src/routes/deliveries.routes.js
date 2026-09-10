const { Router } = require('express');
const deliveryController = require('../controllers/deliveryController');
const documentController = require('../controllers/documentController');
const { authenticate } = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');
const { signatureUpload } = require('../services/deliveryService');

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('delivery.view'), deliveryController.list);
router.get('/:id', requirePermission('delivery.view'), deliveryController.get);
router.get('/:id/tracking', requirePermission('delivery.view'), deliveryController.tracking);
router.post('/:id/confirm', requirePermission('delivery.confirm'), signatureUpload.single('signature'), deliveryController.confirm);
router.get('/:id/documents', requirePermission('delivery.view'), documentController.list('deliveries'));
router.get('/:id/documents/:attachmentId', requirePermission('delivery.view'), documentController.get('deliveries'));

module.exports = router;

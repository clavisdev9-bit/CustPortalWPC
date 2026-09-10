const { Router } = require('express');
const controller = require('../controllers/salesController');
const documentController = require('../controllers/documentController');
const { authenticate } = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('quotation.view'), controller.listQuotations);
router.get('/:id', requirePermission('quotation.view'), controller.getOrder);
router.get('/:id/pdf', requirePermission('quotation.view'), controller.getOrderPdf);
router.post('/:id/approve', requirePermission('quotation.approve'), controller.approveQuotation);
router.post('/:id/reject', requirePermission('quotation.reject'), controller.rejectQuotation);
router.post('/:id/sign', requirePermission('quotation.sign'), controller.signQuotation);
router.get('/:id/lines', requirePermission('quotation.view'), controller.listOrderLines);
router.get('/:id/messages', requirePermission('quotation.view'), controller.listMessages);
router.post('/:id/messages', requirePermission('quotation.comment'), controller.postMessage('quotation'));
router.get('/:id/documents', requirePermission('quotation.view'), documentController.list('quotations'));
router.get('/:id/documents/:attachmentId', requirePermission('quotation.view'), documentController.get('quotations'));

module.exports = router;

const { Router } = require('express');
const invoiceController = require('../controllers/invoiceController');
const paymentController = require('../controllers/paymentController');
const documentController = require('../controllers/documentController');
const { authenticate } = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');
const { proofUpload } = require('../services/paymentService');

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('invoice.view'), invoiceController.list);
router.get('/outstanding', requirePermission('invoice.view'), invoiceController.outstanding);
router.get('/:id', requirePermission('invoice.view'), invoiceController.get);
router.get('/:id/pdf', requirePermission('invoice.download'), invoiceController.pdf);
router.get('/:id/documents', requirePermission('invoice.view'), documentController.list('invoices'));
router.get('/:id/documents/:attachmentId', requirePermission('invoice.view'), documentController.get('invoices'));

router.post('/:id/pay', requirePermission('invoice.pay'), paymentController.createLink);
router.get('/:id/payment-proof', requirePermission('invoice.view'), paymentController.listProofs);
router.post('/:id/payment-proof', requirePermission('invoice.pay'), proofUpload.single('file'), paymentController.uploadProof);

module.exports = router;

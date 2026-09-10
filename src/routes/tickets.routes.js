const { Router } = require('express');
const controller = require('../controllers/helpdeskController');
const documentController = require('../controllers/documentController');
const { authenticate } = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');
const { memoryUploader } = require('../utils/fileStorage');

const attachmentUpload = memoryUploader();

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('ticket.view'), controller.list);
router.post('/', requirePermission('ticket.create'), controller.create);
router.get('/:id', requirePermission('ticket.view'), controller.get);
router.post('/:id/reply', requirePermission('ticket.reply'), controller.reply);
router.get('/:id/messages', requirePermission('ticket.view'), controller.listMessages);
router.post('/:id/messages', requirePermission('ticket.reply'), controller.postMessage);
router.post('/:id/attachments', requirePermission('ticket.reply'), attachmentUpload.single('file'), controller.uploadAttachment);
router.post('/:id/close', requirePermission('ticket.close'), controller.close);
router.post('/:id/reopen', requirePermission('ticket.close'), controller.reopen);
router.get('/:id/documents', requirePermission('ticket.view'), documentController.list('tickets'));
router.get('/:id/documents/:attachmentId', requirePermission('ticket.view'), documentController.get('tickets'));

module.exports = router;

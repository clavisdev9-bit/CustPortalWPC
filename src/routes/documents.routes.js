const { Router } = require('express');
const controller = require('../controllers/documentShareController');
const { authenticate } = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');
const { memoryUploader } = require('../utils/fileStorage');

// Bytes go straight into Odoo as an ir.attachment (no local copy), so the in-memory uploader hands
// the controller a Buffer -- same pattern as helpdesk ticket attachments.
const upload = memoryUploader();

const router = Router();
router.use(authenticate);

// Static/sender routes are declared before the param route so `/sent` and `/recipients/search`
// are never swallowed by `/:id/download`.
router.get('/', requirePermission('document.receive'), controller.listInbox);
router.get('/sent', requirePermission('document.share'), controller.listSent);
router.get('/recipients/search', requirePermission('document.share'), controller.searchRecipients);
router.post('/', requirePermission('document.share'), upload.single('file'), controller.share);
router.post('/:id/revoke', requirePermission('document.share'), controller.revoke);
router.get('/:id/download', requirePermission('document.receive'), controller.download);

module.exports = router;

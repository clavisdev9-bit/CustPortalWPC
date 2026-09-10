const { Router } = require('express');
const controller = require('../controllers/odooConnectionController');
const { authenticate } = require('../middleware/authenticate');
const requirePlatformAdmin = require('../middleware/requirePlatformAdmin');

const router = Router();
router.use(authenticate, requirePlatformAdmin);

router.get('/', controller.list);
// Registered before the /:id family on purpose: this one validates a credential for a connection
// that does not exist yet (CR-044), so its literal path segment must never be read as an :id.
router.post('/check-connection', controller.checkConnection);
router.post('/', controller.create);
router.get('/:id', controller.get);
router.patch('/:id', controller.update);
router.delete('/:id', controller.remove);
router.post('/:id/test-connection', controller.testConnection);
router.get('/:id/companies', controller.listCompanies);
router.post('/:id/sync-companies', controller.syncCompanies);
router.post('/:id/sync-users', controller.syncUsers);
router.post('/:id/webhook-secret/rotate', controller.rotateWebhookSecret);
// Migrasi 0015. Menghentikan/menyalakan pemakaian koneksi tanpa menghapusnya -- satu-satunya
// tindakan di grup ini yang tidak menelepon Odoo, jadi tidak memakai burst limiter.
router.post('/:id/disable', controller.disable);
router.post('/:id/enable', controller.enable);

module.exports = router;

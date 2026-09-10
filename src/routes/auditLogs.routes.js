const { Router } = require('express');
const auditLogController = require('../controllers/auditLogController');
const { authenticate } = require('../middleware/authenticate');
const requirePlatformAdmin = require('../middleware/requirePlatformAdmin');

const router = Router();
// Platform-admin-only for now: audit_logs has no tenant/organization column to scope a
// Customer Admin's view to "their own company" -- see the Phase 1 wrap-up notes.
router.get('/', authenticate, requirePlatformAdmin, auditLogController.list);

module.exports = router;

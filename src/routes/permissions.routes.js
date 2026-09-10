const { Router } = require('express');
const roleController = require('../controllers/roleController');
const { authenticate } = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');

const router = Router();
router.get('/', authenticate, requirePermission('user.view'), roleController.listPermissions);

module.exports = router;

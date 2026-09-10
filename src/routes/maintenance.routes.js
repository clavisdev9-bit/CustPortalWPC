const { Router } = require('express');
const controller = require('../controllers/maintenanceController');
const { authenticate } = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('maintenance.view'), controller.list);
router.get('/:id', requirePermission('maintenance.view'), controller.get);

module.exports = router;

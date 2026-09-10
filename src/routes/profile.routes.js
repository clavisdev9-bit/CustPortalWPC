const { Router } = require('express');
const controller = require('../controllers/customerInfoController');
const { authenticate } = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('profile.view'), controller.getProfile);

module.exports = router;

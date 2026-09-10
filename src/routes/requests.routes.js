const { Router } = require('express');
const controller = require('../controllers/customerRequestController');
const { authenticate } = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('request.view'), controller.list);
router.post('/', requirePermission('request.create'), controller.create);

module.exports = router;

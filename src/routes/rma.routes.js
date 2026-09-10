const { Router } = require('express');
const controller = require('../controllers/rmaController');
const { authenticate } = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('rma.view'), controller.list);
router.post('/', requirePermission('rma.create'), controller.create);
router.get('/:id', requirePermission('rma.view'), controller.get);

module.exports = router;

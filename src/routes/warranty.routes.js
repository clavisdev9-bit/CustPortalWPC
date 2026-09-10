const { Router } = require('express');
const controller = require('../controllers/warrantyController');
const { authenticate } = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');

const router = Router();
router.use(authenticate);

router.get('/lookup-serial', requirePermission('warranty.create'), controller.lookupSerial);
router.get('/', requirePermission('warranty.view'), controller.list);
router.post('/', requirePermission('warranty.create'), controller.create);
router.get('/:id', requirePermission('warranty.view'), controller.get);

module.exports = router;

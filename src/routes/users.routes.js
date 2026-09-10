const { Router } = require('express');
const userController = require('../controllers/userController');
const { authenticate } = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('user.view'), userController.list);
router.post('/', requirePermission('user.create'), userController.create);
router.get('/:id', requirePermission('user.view'), userController.get);
router.patch('/:id', requirePermission('user.create'), userController.update);
router.delete('/:id', requirePermission('user.disable'), userController.disable);

module.exports = router;

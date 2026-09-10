const { Router } = require('express');
const controller = require('../controllers/productController');
const { authenticate } = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');

const router = Router();
router.use(authenticate);

router.get('/purchase-history', requirePermission('product.view'), controller.purchaseHistory);
router.get('/reorder-suggestions', requirePermission('product.view'), controller.reorderSuggestions);
router.get('/', requirePermission('product.view'), controller.list);

module.exports = router;

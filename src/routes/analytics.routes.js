const { Router } = require('express');
const controller = require('../controllers/analyticsController');
const { authenticate } = require('../middleware/authenticate');
const requirePermission = require('../middleware/requirePermission');

const router = Router();
router.use(authenticate);

// Piggybacks on invoice.view/order.view -- this is just an aggregated view of data the caller
// can already see individually, not a new data domain that needs its own permission.
router.get('/spending-trend', requirePermission('invoice.view'), controller.spendingTrend);
router.get('/order-volume-trend', requirePermission('order.view'), controller.orderVolumeTrend);

module.exports = router;

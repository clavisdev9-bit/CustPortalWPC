const { Router } = require('express');
const controller = require('../controllers/dashboardController');
const { authenticate } = require('../middleware/authenticate');

const router = Router();
router.get('/summary', authenticate, controller.summary);

module.exports = router;

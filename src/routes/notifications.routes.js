const { Router } = require('express');
const controller = require('../controllers/notificationController');
const { authenticate } = require('../middleware/authenticate');

const router = Router();
router.use(authenticate);

// No permission gate -- always scoped to the caller's own notifications by user_id.
router.get('/', controller.list);
router.post('/:id/read', controller.markRead);
router.post('/read-all', controller.markAllRead);

module.exports = router;

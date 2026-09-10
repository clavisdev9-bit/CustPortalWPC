const asyncHandler = require('../utils/asyncHandler');
const notificationService = require('../services/notificationService');
const { listNotificationsQuerySchema } = require('../validators/notificationValidators');

const list = asyncHandler(async (req, res) => {
  const query = listNotificationsQuerySchema.parse(req.query);
  // Best-effort and throttled internally -- a failure here must never break the notification
  // list itself, just skip this cycle's Odoo-side check.
  await notificationService
    .checkForUpdates(req.user.id, req.user.currentCompanyId)
    .catch((err) => console.error('checkForUpdates failed:', err.message));
  res.json(await notificationService.list({ userId: req.user.id, ...query }));
});

const markRead = asyncHandler(async (req, res) => {
  await notificationService.markRead(req.params.id, req.user.id);
  res.status(204).end();
});

const markAllRead = asyncHandler(async (req, res) => {
  await notificationService.markAllRead(req.user.id);
  res.status(204).end();
});

module.exports = { list, markRead, markAllRead };

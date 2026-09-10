const auditLogRepository = require('../repositories/auditLogRepository');

function record(req, { action, targetType, targetId, metadata }) {
  return auditLogRepository.record({
    actorUserId: req.user ? req.user.id : null,
    action,
    targetType,
    targetId,
    metadata,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });
}

function list(query) {
  return auditLogRepository.list(query);
}

module.exports = { record, list };

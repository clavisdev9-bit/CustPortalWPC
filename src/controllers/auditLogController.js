const asyncHandler = require('../utils/asyncHandler');
const auditService = require('../services/auditService');
const { listAuditLogsQuerySchema } = require('../validators/auditLogValidators');

const list = asyncHandler(async (req, res) => {
  const query = listAuditLogsQuerySchema.parse(req.query);
  const { rows, total } = await auditService.list(query);
  res.json({ data: rows, meta: { page: query.page, page_size: query.pageSize, total } });
});

module.exports = { list };

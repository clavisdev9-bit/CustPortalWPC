const { z } = require('zod');

const listAuditLogsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(100).default(20),
    actor_user_id: z.string().uuid().optional(),
    action: z.string().optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .transform((v) => ({
    page: v.page,
    pageSize: v.page_size,
    actorUserId: v.actor_user_id,
    action: v.action,
    from: v.from,
    to: v.to,
  }));

module.exports = { listAuditLogsQuerySchema };

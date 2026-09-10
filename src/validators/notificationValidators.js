const { z } = require('zod');

const listNotificationsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(100).default(20),
    unread_only: z.coerce.boolean().optional(),
  })
  .transform((v) => ({ page: v.page, pageSize: v.page_size, unreadOnly: v.unread_only }));

module.exports = { listNotificationsQuerySchema };

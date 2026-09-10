const { z } = require('zod');

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  odoo_connection_id: z.string().uuid(),
  odoo_partner_id: z.number().int().positive(),
  role_ids: z.array(z.string().uuid()).min(1),
  company_ids: z.array(z.string().uuid()).optional(),
});

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  status: z.enum(['active', 'disabled', 'pending_verification']).optional(),
  role_ids: z.array(z.string().uuid()).optional(),
});

const listUsersQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(['active', 'disabled', 'pending_verification']).optional(),
  })
  .transform((v) => ({ page: v.page, pageSize: v.page_size, status: v.status }));

module.exports = { createUserSchema, updateUserSchema, listUsersQuerySchema };

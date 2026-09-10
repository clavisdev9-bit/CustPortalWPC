const { z } = require('zod');

const createRoleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  permission_codes: z.array(z.string()).optional(),
});

const updateRoleSchema = z.object({
  description: z.string().optional(),
  permission_codes: z.array(z.string()).optional(),
});

module.exports = { createRoleSchema, updateRoleSchema };

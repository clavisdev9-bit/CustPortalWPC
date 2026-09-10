const { z } = require('zod');

// max() bumped from 2000 -- see helpdeskValidators.js for why (rich-text editor markup overhead).
const createRmaSchema = z.object({
  order_id: z.coerce.number().int().positive().optional(),
  reason: z.string().min(1).max(6000),
  requested_action: z.enum(['refund', 'replacement']),
});

module.exports = { createRmaSchema };

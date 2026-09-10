const { z } = require('zod');

const confirmDeliverySchema = z.object({
  notes: z.string().max(1000).optional(),
});

module.exports = { confirmDeliverySchema };

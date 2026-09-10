const { z } = require('zod');

const uploadProofSchema = z.object({
  amount: z.coerce.number().positive().optional(),
});

module.exports = { uploadProofSchema };

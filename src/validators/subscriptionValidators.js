const { z } = require('zod');

const requestActionSchema = z.object({
  note: z.string().max(1000).optional(),
});

module.exports = { requestActionSchema };

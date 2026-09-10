const { z } = require('zod');

const quotationLineSchema = z.object({
  product_id: z.coerce.number().int().positive(),
  product_name: z.string().min(1).max(200),
  default_code: z.string().max(64).optional(),
  qty: z.coerce.number().positive(),
});

const createRequestSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('request_quotation'),
    payload: z.object({
      lines: z.array(quotationLineSchema).min(1),
      note: z.string().max(2000).optional(),
    }),
  }),
  z.object({
    type: z.literal('request_product'),
    payload: z.object({
      note: z.string().min(1).max(2000),
    }),
  }),
]);

module.exports = { createRequestSchema };

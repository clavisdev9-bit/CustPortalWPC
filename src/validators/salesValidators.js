const { z } = require('zod');

const rejectQuotationSchema = z.object({
  reason: z.string().max(500).optional(),
});

const signQuotationSchema = z.object({
  signature: z
    .string()
    .min(1)
    .transform((v) => v.replace(/^data:image\/\w+;base64,/, '')),
  signed_by: z.string().min(1).max(150),
});

const postMessageSchema = z.object({
  body: z.string().min(1).max(5000),
});

module.exports = { rejectQuotationSchema, signQuotationSchema, postMessageSchema };

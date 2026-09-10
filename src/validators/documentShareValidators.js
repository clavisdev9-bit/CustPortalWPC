const { z } = require('zod');

// Fields arrive as multipart/form-data (alongside the file part), so everything is a string on the
// wire -- z.coerce turns the numeric fields back into their real types.
const shareSchema = z.object({
  recipient_partner_id: z.coerce.number().int().positive(),
  category: z.string().max(50).optional(),
  note: z.string().max(2000).optional(),
  // A date-only value (YYYY-MM-DD) from the date picker means "through the end of that day", not
  // UTC midnight -- otherwise choosing today would hide the document immediately. The explicit `Z`
  // pins that end-of-day instant to UTC regardless of the API server's local timezone -- without it,
  // `new Date('...T23:59:59')` is parsed in the server process's own timezone, so the same picked
  // date would expire at a different real-world instant depending on where the server happens to be
  // hosted (same class of hazard documented and fixed via parseOdooDatetime() in OdooDocumentsService.js).
  expires_at: z
    .string()
    .optional()
    .transform((v) => (v ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T23:59:59Z` : v) : undefined))
    .refine((d) => d === undefined || !Number.isNaN(d.getTime()), 'Invalid expires_at date'),
});

const searchSchema = z.object({
  q: z.string().max(120).optional().default(''),
});

module.exports = { shareSchema, searchSchema };

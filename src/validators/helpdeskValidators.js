const { z } = require('zod');

// max() bumped from 5000 to cover the rich-text editor's HTML markup overhead on top of the same
// amount of visible text -- sanitizeRichText (src/utils/sanitizeHtml.js) still enforces the actual
// tag allowlist before any of this reaches Odoo.
const createTicketSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(10000).optional(),
});

const replyTicketSchema = z.object({
  body: z.string().min(1).max(10000),
});

const postMessageSchema = z.object({
  body: z.string().min(1).max(10000),
});

module.exports = { createTicketSchema, replyTicketSchema, postMessageSchema };

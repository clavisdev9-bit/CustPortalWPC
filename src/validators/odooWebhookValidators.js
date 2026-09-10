const { z } = require('zod');

// Odoo's built-in "Send a Webhook Notification" server action POSTs a flat dict of whatever
// fields the automation rule was configured to include -- there's no fixed envelope, so this
// stays deliberately lenient rather than binding to one exact shape: `partner_id` (a many2one)
// comes through Odoo's own read() convention as either a bare id or an [id, display_name] tuple
// depending on how the field was selected, and the login/email field name is whatever the Odoo
// admin picked when wiring up the automation rule (documented as `login`, but `email` is accepted
// too so a slightly different setup still works).
const odooManyToOne = z.union([z.number().int().positive(), z.tuple([z.number().int().positive(), z.string()])]);

const userProvisionedWebhookSchema = z
  .object({
    login: z.string().email().optional(),
    email: z.string().email().optional(),
    name: z.string().optional(),
    partner_id: odooManyToOne,
    // BUG-25: optional -- without it, a webhook-provisioned user lands with zero rows in
    // portal_user_companies (empty company picker, every Odoo-scoped endpoint 400s "Select a
    // company first" forever). Documented in Docs/ops/odoo_connection.md section 5 as an
    // additional field worth adding to the Automation Rule's payload, same many2one shape as
    // partner_id -- but kept optional since existing Automation Rules configured before this
    // fix don't send it, and shouldn't suddenly start failing validation.
    company_id: odooManyToOne.optional(),
  })
  .refine((v) => v.login || v.email, { message: 'login or email is required' })
  .transform((v) => ({
    email: (v.email || v.login).toLowerCase(),
    name: v.name || (Array.isArray(v.partner_id) ? v.partner_id[1] : null),
    odooPartnerId: Array.isArray(v.partner_id) ? v.partner_id[0] : v.partner_id,
    odooCompanyId: v.company_id !== undefined ? (Array.isArray(v.company_id) ? v.company_id[0] : v.company_id) : null,
  }));

module.exports = { userProvisionedWebhookSchema };

const { z } = require('zod');

const createConnectionSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  database: z.string().min(1),
  username: z.string().min(1),
  auth_type: z.enum(['password', 'api_key']),
  credential: z.string().min(1),
  // "Select Company" (CR-044): res.company ids the admin ticked. Only ids -- the names/currencies
  // are re-read from Odoo server-side, so a tampered client can't seed odoo_companies with rows
  // that don't exist in the Odoo it just authenticated against. Omitted means "all of them".
  company_ids: z.array(z.number().int().positive()).optional(),
});

const updateConnectionSchema = createConnectionSchema.partial();

// Pre-save validation (CR-044): the credential is checked against Odoo *before* any row exists,
// so this schema is deliberately not derived from createConnectionSchema -- `name` is irrelevant
// at this point (it is asked for on the save step), and `database` is optional because
// discovering it is half of what this endpoint is for.
//
// `connection_id` is how the edit form re-checks an existing connection without re-typing the
// credential: given one, the stored (encrypted) credential is used. It is a portal-side UUID
// looked up server-side, not an identity the client asserts -- and this whole route already sits
// behind requirePlatformAdmin.
const checkConnectionSchema = z
  .object({
    connection_id: z.string().uuid().optional(),
    url: z.string().url(),
    database: z.string().min(1).optional(),
    username: z.string().min(1),
    auth_type: z.enum(['password', 'api_key']).optional(),
    credential: z.string().min(1).optional(),
  })
  .refine((body) => Boolean(body.credential || body.connection_id), {
    message: 'credential is required unless connection_id is given',
    path: ['credential'],
  });

// Body of POST /:id/sync-companies. Entirely optional: without it the sync just refreshes
// names/currencies and leaves the existing selection alone (see odooCompanyRepository.upsertMany).
const syncCompaniesSchema = z.object({
  company_ids: z.array(z.number().int().positive()).optional(),
});

module.exports = { createConnectionSchema, updateConnectionSchema, checkConnectionSchema, syncCompaniesSchema };

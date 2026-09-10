const { z } = require('zod');

// equipment_id lives IN the body, not a URL :id param -- required so this same schema can serve
// both POST /equipment/corrections and the assistant draft flow (actions.js), whose execute()
// only ever receives a payload, never a separate route param. Matches createRmaSchema/
// createWarrantyClaimSchema's own flat shape (order_id / serial_number in body).
const createCorrectionSchema = z.object({
  equipment_id: z.coerce.number().int().positive(),
  correction_type: z.enum(['location', 'status', 'runtime_hours', 'ownership', 'other']),
  proposed_value: z.string().min(1).max(2000),
  note: z.string().max(2000).optional(),
});

module.exports = { createCorrectionSchema };

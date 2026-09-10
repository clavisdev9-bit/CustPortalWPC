const { z } = require('zod');

// max() bumped from 2000 -- see helpdeskValidators.js for why (rich-text editor markup overhead).
const createWarrantyClaimSchema = z.object({
  serial_number: z.string().min(1).max(100),
  issue_description: z.string().min(1).max(6000),
});

const lookupSerialQuerySchema = z.object({
  serial: z.string().min(1).max(100),
});

module.exports = { createWarrantyClaimSchema, lookupSerialQuerySchema };

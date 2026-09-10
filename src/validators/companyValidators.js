const { z } = require('zod');

const switchCompanySchema = z.object({
  company_id: z.string().uuid(),
});

module.exports = { switchCompanySchema };

const asyncHandler = require('../utils/asyncHandler');
const companyService = require('../services/companyService');
const { switchCompanySchema } = require('../validators/companyValidators');

// CR-054: `currentCompanyId` ikut dikirim supaya company yang sedang diduduki sesi tidak pernah
// tersaring keluar dari daftarnya sendiri -- lihat alasannya di `companyService.listForUser`.
const list = asyncHandler(async (req, res) =>
  res.json(await companyService.listForUser(req.user.id, req.user.currentCompanyId)));

const current = asyncHandler(async (req, res) => res.json(await companyService.getCurrent(req.user.currentCompanyId)));

const switchCompany = asyncHandler(async (req, res) => {
  const body = switchCompanySchema.parse(req.body);
  const company = await companyService.switchCompany({
    userId: req.user.id,
    sessionId: req.user.sessionId,
    companyId: body.company_id,
  });
  res.json(company);
});

module.exports = { list, current, switchCompany };

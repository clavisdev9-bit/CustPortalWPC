const asyncHandler = require('../utils/asyncHandler');
const customerInfoService = require('../services/customerInfoService');

const getProfile = asyncHandler(async (req, res) => {
  res.json(await customerInfoService.getProfile(req.user.id, req.user.currentCompanyId));
});

const listAddresses = asyncHandler(async (req, res) => {
  res.json(await customerInfoService.listAddresses(req.user.id, req.user.currentCompanyId));
});

const listContacts = asyncHandler(async (req, res) => {
  res.json(await customerInfoService.listContacts(req.user.id, req.user.currentCompanyId));
});

module.exports = { getProfile, listAddresses, listContacts };

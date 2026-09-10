const asyncHandler = require('../utils/asyncHandler');
const parseOdooId = require('../utils/parseOdooId');
const invoiceService = require('../services/invoiceService');

const list = asyncHandler(async (req, res) => {
  res.json(await invoiceService.listInvoices(req.user.id, req.user.currentCompanyId));
});

const get = asyncHandler(async (req, res) => {
  res.json(await invoiceService.getInvoice(req.user.id, req.user.currentCompanyId, parseOdooId(req.params.id)));
});

const outstanding = asyncHandler(async (req, res) => {
  res.json(await invoiceService.getOutstanding(req.user.id, req.user.currentCompanyId));
});

const pdf = asyncHandler(async (req, res) => {
  const file = await invoiceService.getInvoicePdf(req.user.id, req.user.currentCompanyId, parseOdooId(req.params.id));
  res.set('Content-Type', file.mimetype);
  res.set('Content-Disposition', `inline; filename="${file.name}"`);
  res.send(file.buffer);
});

module.exports = { list, get, outstanding, pdf };

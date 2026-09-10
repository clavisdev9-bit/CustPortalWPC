const asyncHandler = require('../utils/asyncHandler');
const productService = require('../services/productService');

const list = asyncHandler(async (req, res) => {
  res.json(await productService.listProducts(req.user.id, req.user.currentCompanyId));
});

const purchaseHistory = asyncHandler(async (req, res) => {
  res.json(await productService.getPurchaseHistory(req.user.id, req.user.currentCompanyId));
});

const reorderSuggestions = asyncHandler(async (req, res) => {
  res.json(await productService.getReorderSuggestions(req.user.id, req.user.currentCompanyId));
});

module.exports = { list, purchaseHistory, reorderSuggestions };

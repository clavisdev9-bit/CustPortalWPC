const asyncHandler = require('../utils/asyncHandler');
const parseOdooId = require('../utils/parseOdooId');
const documentService = require('../services/documentService');

// Factories bound to one resource type, so each mount point (quotations/orders/invoices/
// deliveries) reuses that resource's own ownership check instead of taking resourceType from
// the request -- a client can never point this at a record type it wasn't routed for.
function list(resourceType) {
  return asyncHandler(async (req, res) => {
    const documents = await documentService.listDocuments(
      req.user.id,
      req.user.currentCompanyId,
      resourceType,
      parseOdooId(req.params.id)
    );
    res.json(documents);
  });
}

function get(resourceType) {
  return asyncHandler(async (req, res) => {
    const file = await documentService.getDocument(
      req.user.id,
      req.user.currentCompanyId,
      resourceType,
      parseOdooId(req.params.id),
      parseOdooId(req.params.attachmentId)
    );
    res.set('Content-Type', file.mimetype);
    res.set('Content-Disposition', `attachment; filename="${file.name}"`);
    res.send(file.buffer);
  });
}

module.exports = { list, get };

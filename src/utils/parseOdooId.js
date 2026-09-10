const ApiError = require('./ApiError');

// sale.order / account.move / stock.picking ids are Odoo integers, not portal UUIDs -- reject
// anything else before it reaches a domain filter sent to Odoo.
function parseOdooId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(400, 'invalid_id', `Invalid id: ${value}`);
  }
  return id;
}

module.exports = parseOdooId;

// Best-effort serial number lookup against stock.lot -- confirms the serial exists in
// inventory records so the customer gets immediate feedback, but does NOT verify this specific
// customer purchased that unit, and does NOT compute warranty-period eligibility: no universal
// "warranty period" field exists in stock Odoo without a dedicated module, and guessing at one
// risks silently telling a customer the wrong answer. Staff verify actual eligibility once the
// linked ticket (created by warrantyService.createClaim) reaches them.
async function lookupSerial(session, serialNumber) {
  const [lot] = await session.searchRead('stock.lot', [['name', '=', serialNumber]], ['id', 'name', 'product_id']);
  return lot || null;
}

module.exports = { lookupSerial };

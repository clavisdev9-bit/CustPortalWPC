const ApiError = require('../../utils/ApiError');

// carrier_tracking_ref deliberately excluded: it only exists once the `delivery` app (carrier/
// shipping integration) is installed, and Odoo's search_read fails the ENTIRE call if any
// requested field is invalid on the model -- discovered live against a real Odoo 18 instance
// with that app not installed, which broke every delivery listing outright. See
// getCarrierTrackingRef() below for how it's fetched instead.
const LIST_FIELDS = ['id', 'name', 'scheduled_date', 'date_done', 'state', 'origin'];

// Maps Odoo's native stock.picking states onto the portal's customer-facing progress labels
// from section 15 -- Odoo has no "Packed"/"Shipped" state out of the box, so this is a display
// approximation, not a guarantee the warehouse workflow uses those exact steps.
const STATE_LABELS = {
  draft: 'Confirmed',
  waiting: 'Confirmed',
  confirmed: 'Processing',
  assigned: 'Packed',
  done: 'Delivered',
  cancel: 'Cancelled',
};

function baseDomain(partnerId, companyId) {
  return [
    ['partner_id', '=', partnerId],
    ['company_id', '=', companyId],
    ['picking_type_id.code', '=', 'outgoing'],
  ];
}

function toPortalStatus(picking) {
  return STATE_LABELS[picking.state] || picking.state;
}

function listDeliveries(session, partnerId, companyId) {
  return session.searchRead('stock.picking', baseDomain(partnerId, companyId), LIST_FIELDS, { order: 'scheduled_date desc' });
}

async function getDelivery(session, partnerId, companyId, pickingId) {
  const [picking] = await session.searchRead(
    'stock.picking',
    [...baseDomain(partnerId, companyId), ['id', '=', pickingId]],
    LIST_FIELDS
  );
  if (!picking) throw new ApiError(404, 'not_found', 'Delivery not found');
  return picking;
}

// Best-effort secondary read, isolated from the main field list so a missing `delivery` app
// only means no tracking ref -- never a broken listing.
async function getCarrierTrackingRef(session, pickingId) {
  try {
    const [picking] = await session.searchRead('stock.picking', [['id', '=', pickingId]], ['carrier_tracking_ref']);
    return picking?.carrier_tracking_ref || null;
  } catch {
    return null;
  }
}

module.exports = { listDeliveries, getDelivery, toPortalStatus, getCarrierTrackingRef };

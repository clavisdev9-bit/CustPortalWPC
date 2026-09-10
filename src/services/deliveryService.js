const fs = require('fs/promises');
const { resolveOdooContext } = require('./odooContext');
const OdooDeliveryService = require('../integrations/odoo/OdooDeliveryService');
const deliveryConfirmationRepository = require('../repositories/deliveryConfirmationRepository');
const notificationService = require('./notificationService');
const { uploader, relativePathFor, absolutePath } = require('../utils/fileStorage');

const SIGNATURE_SUBDIR = 'delivery-confirmations';
const signatureUpload = uploader(SIGNATURE_SUBDIR);

async function listDeliveries(userId, currentCompanyId) {
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId);
  const pickings = await OdooDeliveryService.listDeliveries(session, odooPartnerId, odooCompanyId);
  return pickings.map((p) => ({ ...p, portal_status: OdooDeliveryService.toPortalStatus(p) }));
}

async function getDelivery(userId, currentCompanyId, pickingId) {
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId);
  const picking = await OdooDeliveryService.getDelivery(session, odooPartnerId, odooCompanyId, pickingId);
  return { ...picking, portal_status: OdooDeliveryService.toPortalStatus(picking) };
}

async function getTracking(userId, currentCompanyId, pickingId) {
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId);
  const picking = await OdooDeliveryService.getDelivery(session, odooPartnerId, odooCompanyId, pickingId);
  const carrierTrackingRef = await OdooDeliveryService.getCarrierTrackingRef(session, pickingId);
  return {
    id: picking.id,
    status: OdooDeliveryService.toPortalStatus(picking),
    scheduled_date: picking.scheduled_date,
    date_done: picking.date_done,
    carrier_tracking_ref: carrierTrackingRef,
  };
}

// Same rule as paymentService.uploadProof: multer already wrote the file, so only a failure
// BEFORE the DB row exists should delete it -- resolving the session and the ownership check
// both happen before that point, so both are covered by the one try/catch below.
async function confirmDelivery(userId, currentCompanyId, pickingId, { notes, file }) {
  let context;
  let picking;
  try {
    context = await resolveOdooContext(userId, currentCompanyId);
    picking = await OdooDeliveryService.getDelivery(context.session, context.odooPartnerId, context.odooCompanyId, pickingId);
  } catch (err) {
    if (file) await fs.unlink(absolutePath(relativePathFor(SIGNATURE_SUBDIR, file))).catch(() => {});
    throw err;
  }
  const { session, connectionId } = context;

  let confirmation = await deliveryConfirmationRepository.create({
    portalUserId: userId,
    odooConnectionId: connectionId,
    odooPickingId: pickingId,
    notes,
    signatureFilePath: file ? relativePathFor(SIGNATURE_SUBDIR, file) : null,
  });

  try {
    await session.callMethod('stock.picking', 'message_post', [pickingId], [], {
      body: `Delivery confirmed by customer via portal.${notes ? ` Notes: ${notes}` : ''}`,
    });
    // Confirmed live: the sync itself can succeed while the caller still saw a stale object --
    // markSynced's return value is what actually reflects odoo_synced_at, not the pre-sync row
    // captured above.
    confirmation = await deliveryConfirmationRepository.markSynced(confirmation.id);
  } catch (err) {
    // The customer-facing confirmation still stands even if the Odoo-side note fails --
    // odoo_synced_at staying null is the marker for a future retry/ops pass to pick up.
    console.error(`Failed to push delivery confirmation ${confirmation.id} to Odoo:`, err.message);
  }

  await notificationService
    .notify(userId, {
      type: 'delivery.confirmed',
      title: `Delivery ${picking.name} confirmed`,
      link: `/deliveries/${picking.id}`,
    })
    .catch((err) => console.error('Failed to record delivery-confirmation notification:', err.message));

  return confirmation;
}

module.exports = { signatureUpload, listDeliveries, getDelivery, getTracking, confirmDelivery };

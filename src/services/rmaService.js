const ApiError = require('../utils/ApiError');
const { resolveOdooContext } = require('./odooContext');
const OdooSalesService = require('../integrations/odoo/OdooSalesService');
const OdooHelpdeskService = require('../integrations/odoo/OdooHelpdeskService');
const rmaRequestRepository = require('../repositories/rmaRequestRepository');
const notificationService = require('./notificationService');

function toDto(row, ticket) {
  return {
    id: row.id,
    odoo_order_id: row.odoo_order_id,
    reason: row.reason,
    requested_action: row.requested_action,
    created_at: row.created_at,
    ticket_id: row.odoo_ticket_id,
    status: ticket ? ticket.stage_id?.[1] || null : null,
  };
}

// No dedicated Odoo model for RMA (section 27 needs a custom addon) -- this creates a
// helpdesk.ticket instead, so the actual review/approve/inspect workflow (section 16) happens
// wherever staff already work: Odoo Helpdesk's own stage pipeline.
async function createRma(userId, currentCompanyId, { orderId, reason, requestedAction }) {
  const { session, odooPartnerId, odooCompanyId, connectionId } = await resolveOdooContext(userId, currentCompanyId, { feature: 'helpdesk' });

  if (orderId) {
    // Throws 404 if orderId isn't actually this customer's -- don't let a mistyped/foreign
    // order id silently get embedded in the ticket.
    await OdooSalesService.getOrder(session, odooPartnerId, odooCompanyId, orderId);
  }

  const ticket = await OdooHelpdeskService.createTicket(session, odooPartnerId, odooCompanyId, {
    name: `RMA request${orderId ? ` (Order #${orderId})` : ''}`,
    // `reason` is HTML now (rich text editor), so the prefix has to be real markup too -- a plain
    // `\n\n`-joined string collapses once treated as HTML and the two run together on screen.
    description: `<p><strong>Requested action:</strong> ${requestedAction}</p>${reason}`,
  });

  const row = await rmaRequestRepository.create({
    portalUserId: userId,
    odooConnectionId: connectionId,
    odooOrderId: orderId,
    odooTicketId: ticket.id,
    reason,
    requestedAction,
  });

  await notificationService
    .notify(userId, { type: 'rma.created', title: 'RMA request submitted', link: `/rma/${row.id}` })
    .catch((err) => console.error('Failed to record rma-created notification:', err.message));

  return toDto(row, ticket);
}

async function listRma(userId, currentCompanyId) {
  const { session, odooPartnerId, odooCompanyId, connectionId } = await resolveOdooContext(userId, currentCompanyId);
  const rows = await rmaRequestRepository.listForUser(userId, connectionId);
  return Promise.all(
    rows.map(async (row) => {
      const ticket = await OdooHelpdeskService.getTicket(session, odooPartnerId, odooCompanyId, row.odoo_ticket_id).catch(
        () => null
      );
      return toDto(row, ticket);
    })
  );
}

async function getRma(userId, currentCompanyId, id) {
  const { session, odooPartnerId, odooCompanyId, connectionId } = await resolveOdooContext(userId, currentCompanyId);
  const row = await rmaRequestRepository.findById(id);
  // Checked against the currently-selected connection too, not just portal_user_id -- a row from
  // a different Odoo connection (see identity_mappings) has an odoo_ticket_id that belongs to a
  // different Odoo database and must never be resolved through this session (see BUG-08).
  if (!row || row.portal_user_id !== userId || row.odoo_connection_id !== connectionId) {
    throw new ApiError(404, 'not_found', 'RMA request not found');
  }
  // Sama seperti list-nya (dan BUG-31): baris ini milik portal, hanya STATUS-nya yang berasal dari
  // Odoo. Kalau Helpdesk tidak terpasang -- atau tiketnya sudah dihapus di Odoo -- pelanggan tetap
  // harus bisa membuka pengajuannya sendiri dengan status kosong, bukan kehilangan seluruh detailnya.
  const ticket = await OdooHelpdeskService.getTicket(session, odooPartnerId, odooCompanyId, row.odoo_ticket_id).catch(
    () => null
  );
  return toDto(row, ticket);
}

module.exports = { createRma, listRma, getRma };

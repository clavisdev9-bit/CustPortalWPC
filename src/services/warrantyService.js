const ApiError = require('../utils/ApiError');
const { resolveOdooContext } = require('./odooContext');
const OdooHelpdeskService = require('../integrations/odoo/OdooHelpdeskService');
const OdooWarrantyService = require('../integrations/odoo/OdooWarrantyService');
const warrantyClaimRepository = require('../repositories/warrantyClaimRepository');
const notificationService = require('./notificationService');

function toDto(row, ticket) {
  return {
    id: row.id,
    serial_number: row.serial_number,
    issue_description: row.issue_description,
    created_at: row.created_at,
    ticket_id: row.odoo_ticket_id,
    status: ticket ? ticket.stage_id?.[1] || null : null,
  };
}

async function lookupSerial(userId, currentCompanyId, serialNumber) {
  const { session } = await resolveOdooContext(userId, currentCompanyId);
  return OdooWarrantyService.lookupSerial(session, serialNumber);
}

// Same stopgap as RMA: no dedicated Odoo model, so "Validate Serial/Period/Customer -> Create
// Service Request -> Technician -> Complete" (section 16) collapses into a single Helpdesk
// ticket that staff work through Odoo's own pipeline. Field mapping is direct (serial_number ->
// name, issue_description -> description, same treatment as the plain ticket module) with the
// Type set to "Warranty" so staff can tell these apart in Odoo's own ticket list/filters.
async function createClaim(userId, currentCompanyId, { serialNumber, issueDescription }) {
  const { session, odooPartnerId, odooCompanyId, connectionId } = await resolveOdooContext(userId, currentCompanyId, { feature: 'helpdesk' });

  const ticket = await OdooHelpdeskService.createTicket(session, odooPartnerId, odooCompanyId, {
    name: serialNumber,
    description: issueDescription,
    ticketTypeName: 'Warranty',
  });

  const row = await warrantyClaimRepository.create({
    portalUserId: userId,
    odooConnectionId: connectionId,
    serialNumber,
    odooTicketId: ticket.id,
    issueDescription,
  });

  await notificationService
    .notify(userId, { type: 'warranty.created', title: 'Warranty claim submitted', link: `/warranty/${row.id}` })
    .catch((err) => console.error('Failed to record warranty-created notification:', err.message));

  return toDto(row, ticket);
}

async function listClaims(userId, currentCompanyId) {
  const { session, odooPartnerId, odooCompanyId, connectionId } = await resolveOdooContext(userId, currentCompanyId);
  const rows = await warrantyClaimRepository.listForUser(userId, connectionId);
  return Promise.all(
    rows.map(async (row) => {
      const ticket = await OdooHelpdeskService.getTicket(session, odooPartnerId, odooCompanyId, row.odoo_ticket_id).catch(
        () => null
      );
      return toDto(row, ticket);
    })
  );
}

async function getClaim(userId, currentCompanyId, id) {
  const { session, odooPartnerId, odooCompanyId, connectionId } = await resolveOdooContext(userId, currentCompanyId);
  const row = await warrantyClaimRepository.findById(id);
  // Checked against the currently-selected connection too -- see rmaService.getRma for why.
  if (!row || row.portal_user_id !== userId || row.odoo_connection_id !== connectionId) {
    throw new ApiError(404, 'not_found', 'Warranty claim not found');
  }
  // Sama seperti list-nya (dan BUG-31): baris ini milik portal, hanya STATUS-nya yang berasal dari
  // Odoo. Kalau Helpdesk tidak terpasang -- atau tiketnya sudah dihapus di Odoo -- pelanggan tetap
  // harus bisa membuka pengajuannya sendiri dengan status kosong, bukan kehilangan seluruh detailnya.
  const ticket = await OdooHelpdeskService.getTicket(session, odooPartnerId, odooCompanyId, row.odoo_ticket_id).catch(
    () => null
  );
  return toDto(row, ticket);
}

module.exports = { lookupSerial, createClaim, listClaims, getClaim };

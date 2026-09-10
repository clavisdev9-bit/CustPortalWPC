const ApiError = require('../../utils/ApiError');
const { sanitizeRichText } = require('../../utils/sanitizeHtml');

const LIST_FIELDS = ['id', 'name', 'description', 'stage_id', 'priority', 'team_id', 'user_id', 'create_date'];
const MESSAGE_FIELDS = ['id', 'author_id', 'body', 'date', 'message_type'];

function baseDomain(partnerId, companyId) {
  return [
    ['partner_id', '=', partnerId],
    ['company_id', '=', companyId],
  ];
}

// Same rule as every other Odoo-backed service: filter by partner_id + company_id even on a
// single id, so a ticket belonging to another customer 404s instead of ever being read (section 22).
async function ensureOwned(session, partnerId, companyId, ticketId) {
  const [ticket] = await session.searchRead(
    'helpdesk.ticket',
    [...baseDomain(partnerId, companyId), ['id', '=', ticketId]],
    LIST_FIELDS
  );
  if (!ticket) throw new ApiError(404, 'not_found', 'Ticket not found');
  return ticket;
}

function listTickets(session, partnerId, companyId) {
  return session.searchRead('helpdesk.ticket', baseDomain(partnerId, companyId), LIST_FIELDS, { order: 'create_date desc' });
}

function getTicket(session, partnerId, companyId, ticketId) {
  return ensureOwned(session, partnerId, companyId, ticketId);
}

// Looked up by name rather than a hardcoded id because ticket types are configured per-Odoo-instance
// (Settings > Helpdesk > Ticket Types) and their ids aren't stable across databases.
async function resolveTicketTypeId(session, typeName) {
  const [type] = await session.searchRead('helpdesk.ticket.type', [['name', '=', typeName]], ['id']);
  return type ? type.id : null;
}

async function createTicket(session, partnerId, companyId, { name, description, ticketTypeName }) {
  const data = {
    name,
    description: sanitizeRichText(description),
    partner_id: partnerId,
    company_id: companyId,
  };
  if (ticketTypeName) {
    // Soft-fail on *any* lookup failure, not just "no matching record" -- some Odoo installs
    // (Community, or Helpdesk without the Types submodule) don't have this model registered at
    // all, which faults the whole XML-RPC call rather than returning an empty result. Either way,
    // a Type is a triage aid for staff, not a required field, so it must never block submission.
    try {
      const ticketTypeId = await resolveTicketTypeId(session, ticketTypeName);
      if (ticketTypeId) {
        data.ticket_type_id = ticketTypeId;
      } else {
        console.warn(`Helpdesk ticket type "${ticketTypeName}" not found in Odoo -- creating ticket without a type.`);
      }
    } catch (err) {
      console.warn(`Helpdesk ticket type lookup failed ("${ticketTypeName}") -- creating ticket without a type:`, err.message);
    }
  }
  const ticketId = await session.create('helpdesk.ticket', data);
  return ensureOwned(session, partnerId, companyId, ticketId);
}

async function replyTicket(session, partnerId, companyId, ticketId, body) {
  await ensureOwned(session, partnerId, companyId, ticketId);
  await session.callMethod('helpdesk.ticket', 'message_post', [ticketId], [], { body: sanitizeRichText(body) });
  return ensureOwned(session, partnerId, companyId, ticketId);
}

async function addAttachment(session, partnerId, companyId, ticketId, { name, mimetype, base64 }) {
  await ensureOwned(session, partnerId, companyId, ticketId);
  await session.create('ir.attachment', {
    name,
    mimetype,
    datas: base64,
    res_model: 'helpdesk.ticket',
    res_id: ticketId,
  });
  return ensureOwned(session, partnerId, companyId, ticketId);
}

// Reads helpdesk.ticket's own chatter (mail.message), same pattern as
// OdooSalesService.listMessages -- filtered to is_internal=false so internal agent notes never
// leak to the customer.
async function listMessages(session, partnerId, companyId, ticketId) {
  await ensureOwned(session, partnerId, companyId, ticketId);
  return session.searchRead(
    'mail.message',
    [
      ['model', '=', 'helpdesk.ticket'],
      ['res_id', '=', ticketId],
      ['is_internal', '=', false],
      ['message_type', 'in', ['comment', 'notification', 'email']],
    ],
    MESSAGE_FIELDS,
    { order: 'date asc' }
  );
}

// Posts a customer comment onto the ticket's chatter thread, then re-reads it so the caller gets
// the new entry back without a second round trip.
async function postMessage(session, partnerId, companyId, ticketId, body) {
  await ensureOwned(session, partnerId, companyId, ticketId);
  await session.callMethod('helpdesk.ticket', 'message_post', [ticketId], [], {
    body: sanitizeRichText(body),
    message_type: 'comment',
  });
  return listMessages(session, partnerId, companyId, ticketId);
}

// Closing/reopening is stage-based in Odoo Helpdesk. helpdesk.stage has no is_close field in
// Odoo 18 Enterprise (verified live via fields_get) -- it uses `fold` instead, the same
// "folded in Kanban" boolean shared by crm.stage/project.task.type/etc., which is the standard
// signal for a done/closed-style stage across Odoo apps generally. This still picks *any*
// matching stage rather than the correct one for the ticket's specific team, since team-specific
// stage configuration varies too much to resolve generically over XML-RPC.
async function closeTicket(session, partnerId, companyId, ticketId) {
  await ensureOwned(session, partnerId, companyId, ticketId);
  const [closeStage] = await session.searchRead('helpdesk.stage', [['fold', '=', true]], ['id'], {
    order: 'sequence asc',
    limit: 1,
  });
  if (!closeStage) throw new ApiError(502, 'no_close_stage', 'No closing (folded) stage is configured in Odoo Helpdesk');
  await session.write('helpdesk.ticket', [ticketId], { stage_id: closeStage.id });
  return ensureOwned(session, partnerId, companyId, ticketId);
}

async function reopenTicket(session, partnerId, companyId, ticketId) {
  await ensureOwned(session, partnerId, companyId, ticketId);
  const [openStage] = await session.searchRead('helpdesk.stage', [['fold', '=', false]], ['id'], {
    order: 'sequence asc',
    limit: 1,
  });
  if (!openStage) throw new ApiError(502, 'no_open_stage', 'No open stage is configured in Odoo Helpdesk');
  await session.write('helpdesk.ticket', [ticketId], { stage_id: openStage.id });
  return ensureOwned(session, partnerId, companyId, ticketId);
}

module.exports = {
  listTickets,
  getTicket,
  createTicket,
  replyTicket,
  addAttachment,
  listMessages,
  postMessage,
  closeTicket,
  reopenTicket,
};

const { resolveOdooContext } = require('./odooContext');
const OdooHelpdeskService = require('../integrations/odoo/OdooHelpdeskService');
const notificationService = require('./notificationService');

async function listTickets(userId, currentCompanyId) {
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId, { feature: 'helpdesk' });
  return OdooHelpdeskService.listTickets(session, odooPartnerId, odooCompanyId);
}

async function getTicket(userId, currentCompanyId, ticketId) {
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId, { feature: 'helpdesk' });
  return OdooHelpdeskService.getTicket(session, odooPartnerId, odooCompanyId, ticketId);
}

async function createTicket(userId, currentCompanyId, { name, description }) {
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId, { feature: 'helpdesk' });
  const ticket = await OdooHelpdeskService.createTicket(session, odooPartnerId, odooCompanyId, { name, description });
  await notificationService
    .notify(userId, { type: 'ticket.created', title: `Ticket ${ticket.name} created`, link: `/tickets/${ticket.id}` })
    .catch((err) => console.error('Failed to record ticket-created notification:', err.message));
  return ticket;
}

async function replyTicket(userId, currentCompanyId, ticketId, body) {
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId, { feature: 'helpdesk' });
  return OdooHelpdeskService.replyTicket(session, odooPartnerId, odooCompanyId, ticketId, body);
}

async function uploadAttachment(userId, currentCompanyId, ticketId, file) {
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId, { feature: 'helpdesk' });
  return OdooHelpdeskService.addAttachment(session, odooPartnerId, odooCompanyId, ticketId, {
    name: file.originalname,
    mimetype: file.mimetype,
    base64: file.buffer.toString('base64'),
  });
}

async function listMessages(userId, currentCompanyId, ticketId) {
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId, { feature: 'helpdesk' });
  return OdooHelpdeskService.listMessages(session, odooPartnerId, odooCompanyId, ticketId);
}

async function postMessage(userId, currentCompanyId, ticketId, body) {
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId, { feature: 'helpdesk' });
  return OdooHelpdeskService.postMessage(session, odooPartnerId, odooCompanyId, ticketId, body);
}

async function closeTicket(userId, currentCompanyId, ticketId) {
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId, { feature: 'helpdesk' });
  const ticket = await OdooHelpdeskService.closeTicket(session, odooPartnerId, odooCompanyId, ticketId);
  await notificationService
    .notify(userId, { type: 'ticket.closed', title: `Ticket ${ticket.name} closed`, link: `/tickets/${ticket.id}` })
    .catch((err) => console.error('Failed to record ticket-closed notification:', err.message));
  return ticket;
}

async function reopenTicket(userId, currentCompanyId, ticketId) {
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId, { feature: 'helpdesk' });
  const ticket = await OdooHelpdeskService.reopenTicket(session, odooPartnerId, odooCompanyId, ticketId);
  await notificationService
    .notify(userId, { type: 'ticket.reopened', title: `Ticket ${ticket.name} reopened`, link: `/tickets/${ticket.id}` })
    .catch((err) => console.error('Failed to record ticket-reopened notification:', err.message));
  return ticket;
}

module.exports = {
  listTickets,
  getTicket,
  createTicket,
  replyTicket,
  uploadAttachment,
  listMessages,
  postMessage,
  closeTicket,
  reopenTicket,
};

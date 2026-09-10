import { apiFetch, apiFetchForm } from './client';

export const listTickets = () => apiFetch('/tickets');
export const getTicket = (id) => apiFetch(`/tickets/${id}`);
export const createTicket = (body) => apiFetch('/tickets', { method: 'POST', body });
export const replyTicket = (id, body) => apiFetch(`/tickets/${id}/reply`, { method: 'POST', body: { body } });
export const listTicketMessages = (id) => apiFetch(`/tickets/${id}/messages`);
export const postTicketMessage = (id, body) => apiFetch(`/tickets/${id}/messages`, { method: 'POST', body: { body } });
export const closeTicket = (id) => apiFetch(`/tickets/${id}/close`, { method: 'POST' });
export const reopenTicket = (id) => apiFetch(`/tickets/${id}/reopen`, { method: 'POST' });

export function uploadTicketAttachment(id, file) {
  const form = new FormData();
  form.append('file', file);
  return apiFetchForm(`/tickets/${id}/attachments`, form);
}

const asyncHandler = require('../utils/asyncHandler');
const parseOdooId = require('../utils/parseOdooId');
const helpdeskService = require('../services/helpdeskService');
const auditService = require('../services/auditService');
const { createTicketSchema, replyTicketSchema, postMessageSchema } = require('../validators/helpdeskValidators');
const ApiError = require('../utils/ApiError');

const list = asyncHandler(async (req, res) => {
  res.json(await helpdeskService.listTickets(req.user.id, req.user.currentCompanyId));
});

const get = asyncHandler(async (req, res) => {
  res.json(await helpdeskService.getTicket(req.user.id, req.user.currentCompanyId, parseOdooId(req.params.id)));
});

const create = asyncHandler(async (req, res) => {
  const body = createTicketSchema.parse(req.body);
  const ticket = await helpdeskService.createTicket(req.user.id, req.user.currentCompanyId, body);
  await auditService.record(req, { action: 'ticket.create', targetType: 'helpdesk.ticket', targetId: String(ticket.id) });
  res.status(201).json(ticket);
});

const reply = asyncHandler(async (req, res) => {
  const body = replyTicketSchema.parse(req.body);
  const ticketId = parseOdooId(req.params.id);
  const ticket = await helpdeskService.replyTicket(req.user.id, req.user.currentCompanyId, ticketId, body.body);
  await auditService.record(req, { action: 'ticket.reply', targetType: 'helpdesk.ticket', targetId: String(ticketId) });
  res.json(ticket);
});

const listMessages = asyncHandler(async (req, res) => {
  res.json(await helpdeskService.listMessages(req.user.id, req.user.currentCompanyId, parseOdooId(req.params.id)));
});

const postMessage = asyncHandler(async (req, res) => {
  const body = postMessageSchema.parse(req.body);
  const ticketId = parseOdooId(req.params.id);
  const messages = await helpdeskService.postMessage(req.user.id, req.user.currentCompanyId, ticketId, body.body);
  await auditService.record(req, { action: 'ticket.comment', targetType: 'helpdesk.ticket', targetId: String(ticketId) });
  res.status(201).json(messages);
});

const uploadAttachment = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'file_required', 'A file is required');
  const ticketId = parseOdooId(req.params.id);
  const ticket = await helpdeskService.uploadAttachment(req.user.id, req.user.currentCompanyId, ticketId, req.file);
  await auditService.record(req, {
    action: 'ticket.attachment_upload',
    targetType: 'helpdesk.ticket',
    targetId: String(ticketId),
  });
  res.status(201).json(ticket);
});

const close = asyncHandler(async (req, res) => {
  const ticketId = parseOdooId(req.params.id);
  const ticket = await helpdeskService.closeTicket(req.user.id, req.user.currentCompanyId, ticketId);
  await auditService.record(req, { action: 'ticket.close', targetType: 'helpdesk.ticket', targetId: String(ticketId) });
  res.json(ticket);
});

const reopen = asyncHandler(async (req, res) => {
  const ticketId = parseOdooId(req.params.id);
  const ticket = await helpdeskService.reopenTicket(req.user.id, req.user.currentCompanyId, ticketId);
  await auditService.record(req, { action: 'ticket.reopen', targetType: 'helpdesk.ticket', targetId: String(ticketId) });
  res.json(ticket);
});

module.exports = { list, get, create, reply, listMessages, postMessage, uploadAttachment, close, reopen };

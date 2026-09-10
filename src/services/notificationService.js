const pool = require('../db/pool');
const notificationRepository = require('../repositories/notificationRepository');
const { resolveOdooContext } = require('./odooContext');

const MIN_CHECK_INTERVAL_MS = 30_000;

// Called synchronously by other services right after a portal-driven action succeeds (e.g.
// "quotation approved"). checkForUpdates() below is the complementary path for changes made
// directly in Odoo by staff, not through the portal.
function notify(portalUserId, { type, title, body, link }) {
  return notificationRepository.create({ portalUserId, type, title, body, link });
}

function toOdooDatetime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

// Phase 7's "Real-time Notification", built the way section 21 frames the initial stage: the
// frontend polls this (via GET /notifications) every 30-60s, and each poll does a bounded
// "what changed since last time" read -- not an unconditional background job hammering Odoo on
// a timer regardless of whether anyone is even looking at the portal. Throttled per
// user+connection via last_polled_at so rapid repeated polls don't re-hit Odoo every time.
async function checkForUpdates(userId, currentCompanyId) {
  if (!currentCompanyId) return;

  let context;
  try {
    context = await resolveOdooContext(userId, currentCompanyId);
  } catch {
    return; // no identity mapping / Odoo unreachable -- this is best-effort enrichment, not a hard dependency
  }

  const { rows } = await pool.query(
    'SELECT id, last_polled_at FROM identity_mappings WHERE portal_user_id = $1 AND odoo_connection_id = $2',
    [userId, context.connectionId]
  );
  const mapping = rows[0];
  if (!mapping) return;
  if (Date.now() - new Date(mapping.last_polled_at).getTime() < MIN_CHECK_INTERVAL_MS) return;

  const since = toOdooDatetime(new Date(mapping.last_polled_at));
  const { session, odooPartnerId } = context;

  const [paidInvoices, deliveredPickings, updatedTickets] = await Promise.all([
    session
      .searchRead(
        'account.move',
        [
          ['partner_id', '=', odooPartnerId],
          // 'in_payment' is included alongside 'paid': a payment registered against a bank/cash
          // journal sits here until the bank statement is reconciled, which can take days -- from
          // the customer's perspective their payment has already been recorded either way. This
          // also matches getOutstanding()'s own not_paid/partial filter, which already treats
          // in_payment as "no longer outstanding".
          ['payment_state', 'in', ['paid', 'in_payment']],
          ['write_date', '>', since],
        ],
        ['id', 'name']
      )
      .catch(() => []),
    session
      .searchRead(
        'stock.picking',
        [
          ['partner_id', '=', odooPartnerId],
          ['state', '=', 'done'],
          ['picking_type_id.code', '=', 'outgoing'],
          ['write_date', '>', since],
        ],
        ['id', 'name']
      )
      .catch(() => []),
    session
      .searchRead(
        'helpdesk.ticket',
        [
          ['partner_id', '=', odooPartnerId],
          ['write_date', '>', since],
        ],
        ['id', 'name']
      )
      .catch(() => []),
  ]);

  for (const inv of paidInvoices) {
    await notify(userId, { type: 'invoice.paid', title: `Invoice ${inv.name} has been paid.`, link: `/invoices/${inv.id}` });
  }
  for (const picking of deliveredPickings) {
    await notify(userId, {
      type: 'delivery.delivered',
      title: `Order ${picking.name} has been delivered.`,
      link: `/deliveries/${picking.id}`,
    });
  }
  for (const ticket of updatedTickets) {
    await notify(userId, {
      type: 'ticket.updated',
      title: `Ticket ${ticket.name} has been updated.`,
      link: `/tickets/${ticket.id}`,
    });
  }

  await pool.query('UPDATE identity_mappings SET last_polled_at = now() WHERE id = $1', [mapping.id]);
}

async function list({ userId, page = 1, pageSize = 20, unreadOnly = false }) {
  const { rows, total, unread } = await notificationRepository.list({ userId, page, pageSize, unreadOnly });
  return { data: rows, meta: { page, page_size: pageSize, total, unread } };
}

function markRead(id, userId) {
  return notificationRepository.markRead(id, userId);
}

function markAllRead(userId) {
  return notificationRepository.markAllRead(userId);
}

module.exports = { notify, checkForUpdates, list, markRead, markAllRead };

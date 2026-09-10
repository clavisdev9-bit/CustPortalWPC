// Uses Odoo's read_group for server-side aggregation rather than pulling every invoice/order
// row and summing client-side. Confirmed live against a real Odoo 18 instance: the grouped key
// is a display label ("April 2026"), the summed field keeps its plain name, and the count comes
// back as `${groupbyField}_count` (not `__count`).
async function getSpendingTrend(session, partnerId, companyId) {
  const groups = await session.readGroup(
    'account.move',
    [
      ['partner_id', '=', partnerId],
      ['company_id', '=', companyId],
      ['move_type', '=', 'out_invoice'],
      ['state', '=', 'posted'],
    ],
    ['amount_total:sum'],
    ['invoice_date:month']
  );
  return groups.map((g) => ({
    month: g['invoice_date:month'],
    total: g.amount_total,
    invoice_count: g.invoice_date_count,
  }));
}

async function getOrderVolumeTrend(session, partnerId, companyId) {
  const groups = await session.readGroup(
    'sale.order',
    [
      ['partner_id', '=', partnerId],
      ['company_id', '=', companyId],
      ['state', 'in', ['sale', 'done']],
    ],
    ['amount_total:sum'],
    ['date_order:month']
  );
  return groups.map((g) => ({
    month: g['date_order:month'],
    total: g.amount_total,
    order_count: g.date_order_count,
  }));
}

module.exports = { getSpendingTrend, getOrderVolumeTrend };

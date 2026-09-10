// Catalog + purchase history only. Customer-specific pricelist computation (section 31's
// "Customer Price") is deliberately left out here -- Odoo's pricelist rule engine is intricate
// and its exact ORM entry point varies enough by version that guessing at it risks quietly
// showing the wrong price. list_price (the standard price) is shown instead until this is
// verified against the target Odoo.
async function listProducts(session, companyId) {
  return session.searchRead(
    'product.product',
    [
      ['sale_ok', '=', true],
      '|',
      ['company_id', '=', false],
      ['company_id', '=', companyId],
    ],
    ['id', 'name', 'default_code', 'list_price', 'qty_available', 'uom_id']
  );
}

async function getPurchaseHistory(session, partnerId, companyId) {
  return session.searchRead(
    'sale.order.line',
    [
      ['order_id.partner_id', '=', partnerId],
      ['order_id.company_id', '=', companyId],
      ['order_id.state', 'in', ['sale', 'done']],
    ],
    ['product_id', 'product_uom_qty', 'price_unit', 'order_id'],
    { order: 'id desc' }
  );
}

module.exports = { listProducts, getPurchaseHistory };

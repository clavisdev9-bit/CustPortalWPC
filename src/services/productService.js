const { resolveOdooContext } = require('./odooContext');
const OdooProductService = require('../integrations/odoo/OdooProductService');

async function listProducts(userId, currentCompanyId) {
  const { session, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId);
  return OdooProductService.listProducts(session, odooCompanyId);
}

async function getPurchaseHistory(userId, currentCompanyId) {
  const { session, odooPartnerId, odooCompanyId } = await resolveOdooContext(userId, currentCompanyId);
  return OdooProductService.getPurchaseHistory(session, odooPartnerId, odooCompanyId);
}

// Phase 7's "Recommendation", scoped honestly: products this customer has actually ordered
// before, ranked by how often -- not a similarity/collaborative-filtering engine, which needs
// far more data and design than a fixed phase deliverable can responsibly promise.
async function getReorderSuggestions(userId, currentCompanyId, limit = 5) {
  const lines = await getPurchaseHistory(userId, currentCompanyId);
  const byProduct = new Map();
  for (const line of lines) {
    if (!line.product_id) continue;
    const [productId, productName] = line.product_id;
    const existing = byProduct.get(productId) || {
      product_id: productId,
      product_name: productName,
      order_count: 0,
      total_qty: 0,
    };
    existing.order_count += 1;
    existing.total_qty += line.product_uom_qty || 0;
    byProduct.set(productId, existing);
  }
  return Array.from(byProduct.values())
    .sort((a, b) => b.order_count - a.order_count)
    .slice(0, limit);
}

module.exports = { listProducts, getPurchaseHistory, getReorderSuggestions };

const { resolveOdooContext } = require('./odooContext');
const OdooSalesService = require('../integrations/odoo/OdooSalesService');
const OdooInvoiceService = require('../integrations/odoo/OdooInvoiceService');
const OdooHelpdeskService = require('../integrations/odoo/OdooHelpdeskService');
const portalUserRepository = require('../repositories/portalUserRepository');
const odooCapabilityService = require('./odooCapabilityService');

// tickets stays null for a user without ticket.view (section 6 only grants Helpdesk to
// Customer Admin) -- the dashboard must not leak a ticket count to roles that can't see tickets
// at all, even though Helpdesk itself now exists.
async function getSummary(userId, currentCompanyId) {
  const { session, odooPartnerId, odooCompanyId, connectionId } = await resolveOdooContext(userId, currentCompanyId);
  const [user, permissions] = await Promise.all([
    portalUserRepository.findById(userId),
    portalUserRepository.getPermissionCodes(userId),
  ]);
  // BUG-31: `tickets: null` sebelumnya hanya berarti "tidak punya ticket.view". Sekarang ia juga
  // berarti "Odoo ini tidak punya modul Helpdesk". Tanpa pemeriksaan ini, satu modul OPSIONAL yang
  // tidak terpasang menjatuhkan SELURUH dashboard lewat Promise.all -- halaman pertama yang
  // dilihat pelanggan setelah login menjadi layar error, padahal quotation/order/invoice-nya
  // sehat. Kartu KPI yang hilang jauh lebih baik daripada dashboard yang mati.
  const capabilities = await odooCapabilityService.getCapabilities(session, connectionId);
  const canViewTickets =
    capabilities.helpdesk && (Boolean(user?.is_platform_admin) || permissions.includes('ticket.view'));

  const [quotations, orders, invoices, outstanding, tickets] = await Promise.all([
    OdooSalesService.listQuotations(session, odooPartnerId, odooCompanyId),
    OdooSalesService.listOrders(session, odooPartnerId, odooCompanyId),
    OdooInvoiceService.listInvoices(session, odooPartnerId, odooCompanyId),
    OdooInvoiceService.getOutstanding(session, odooPartnerId, odooCompanyId),
    canViewTickets ? OdooHelpdeskService.listTickets(session, odooPartnerId, odooCompanyId) : Promise.resolve(null),
  ]);

  return {
    quotations: quotations.length,
    orders: orders.length,
    invoices: invoices.length,
    tickets: tickets ? tickets.length : null,
    outstanding,
  };
}

module.exports = { getSummary };

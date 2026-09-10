const { clientFor } = require('./OdooAuthService');

// Backs POST /admin/odoo-connections/{id}/sync-users (BUG-24): "Portal" in Odoo's own UI means a
// res.users row with share=true (created by the "Grant Portal Access" action on a contact) --
// there is no separate "portal user" model. `login`/`email` are usually identical but not
// guaranteed to be (Odoo lets them diverge post-creation), so both are read and the caller
// decides the fallback -- same as OdooCompanyService.list's (connection, credential) pattern
// (admin-triggered, not a customer-scoped session read).
async function listPortalUsers(connection, credential) {
  const client = clientFor(connection);
  const uid = await client.authenticate(connection.username, credential);
  return client.searchRead(
    uid,
    credential,
    'res.users',
    [['share', '=', true], ['active', '=', true]],
    // company_id backs BUG-25's default-company assignment (odooConnectionService.syncUsers) --
    // without it, a synced user has no portal_user_companies row and every Odoo-scoped endpoint
    // (dashboard, quotations, invoices, ...) 400s "Select a company first" forever, with no path
    // for the user to self-serve a fix (GET /companies would return empty too).
    ['login', 'email', 'name', 'partner_id', 'company_id']
  );
}

// Validates that a res.partner exists before a portal user is mapped to it (identity_mappings).
async function findById(connection, credential, partnerId) {
  const client = clientFor(connection);
  const uid = await client.authenticate(connection.username, credential);
  const [partner] = await client.searchRead(
    uid,
    credential,
    'res.partner',
    [['id', '=', partnerId]],
    ['id', 'name', 'email', 'company_id']
  );
  return partner || null;
}

// Resolves "every res.partner id that belongs to the same customer organization as partnerId",
// using Odoo's own commercial_partner_id (the top-level commercial entity a contact rolls up to,
// e.g. every PIC/child contact of "AYU SENTOSA SEJAHTERA, PT" shares its commercial_partner_id)
// rather than a single parent_id hop -- this is what lets user-management scoping (CR
// customer_portal_odoo18_customer_scoped_access.md, section 11/12/19) match the same "authorized
// partner + its children" rule already used for addresses/contacts, without trusting anything the
// client sends.
async function findFamilyIds(connection, credential, partnerId) {
  const client = clientFor(connection);
  const uid = await client.authenticate(connection.username, credential);
  const [partner] = await client.searchRead(
    uid,
    credential,
    'res.partner',
    [['id', '=', partnerId]],
    ['id', 'commercial_partner_id']
  );
  if (!partner) return [];

  const rootId = Array.isArray(partner.commercial_partner_id) ? partner.commercial_partner_id[0] : partnerId;
  const family = await client.searchRead(
    uid,
    credential,
    'res.partner',
    [['commercial_partner_id', '=', rootId]],
    ['id']
  );
  return family.map((p) => p.id);
}

// Recipient lookup/search for staff document-sharing (Option B). These take an already-open
// `session` (from resolveOdooContext) rather than (connection, credential) like findById above --
// the sharing flow always has a live session, so re-authenticating per call would be wasteful.
function search(session, query, limit = 20) {
  const q = (query || '').trim();
  // Name-or-email contains-match, capped. Kept deliberately broad (no customer_rank filter) so it
  // works even where the sale module isn't installed; the sender picks the exact recipient.
  const domain = q ? ['|', ['name', 'ilike', q], ['email', 'ilike', q]] : [];
  return session.searchRead('res.partner', domain, ['id', 'name', 'email'], { limit, order: 'name asc' });
}

async function findByIdViaSession(session, partnerId) {
  const [partner] = await session.searchRead('res.partner', [['id', '=', partnerId]], ['id', 'name', 'email']);
  return partner || null;
}

// Same family-expansion rule as findFamilyIds (D-4, CR customer_population_installed_base.md),
// via an already-open session instead of (connection, credential) -- callers that already
// authenticated for other reads (e.g. equipmentService) would otherwise re-authenticate a second
// time just to resolve the partner family, doubling an RPC round trip for no reason. Mirrors the
// findById/findByIdViaSession split already in this file.
async function findFamilyIdsViaSession(session, partnerId) {
  const [partner] = await session.searchRead('res.partner', [['id', '=', partnerId]], ['id', 'commercial_partner_id']);
  if (!partner) return [];

  const rootId = Array.isArray(partner.commercial_partner_id) ? partner.commercial_partner_id[0] : partnerId;
  const family = await session.searchRead('res.partner', [['commercial_partner_id', '=', rootId]], ['id']);
  return family.map((p) => p.id);
}

module.exports = { findById, findFamilyIds, findFamilyIdsViaSession, search, findByIdViaSession, listPortalUsers };

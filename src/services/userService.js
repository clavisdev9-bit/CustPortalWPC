const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const portalUserRepository = require('../repositories/portalUserRepository');
const portalRoleRepository = require('../repositories/portalRoleRepository');
const identityMappingRepository = require('../repositories/identityMappingRepository');
const odooConnectionRepository = require('../repositories/odooConnectionRepository');
const odooCompanyRepository = require('../repositories/odooCompanyRepository');
const OdooPartnerService = require('../integrations/odoo/OdooPartnerService');
const odooContext = require('./odooContext');
const crypto = require('../utils/crypto');
const ApiError = require('../utils/ApiError');
const authService = require('./authService');
const emailService = require('./emailService');
const env = require('../config/env');

// Section 19: RBAC ("can this user manage portal users at all?") is enforced by requirePermission
// on the route. This resolves the separate question -- "whose portal users?" -- from the acting
// user's own session-derived identity, exactly like every customer-data endpoint resolves
// authorized_partner_id. A platform admin (operates the SaaS itself) is exempt, matching
// requirePermission's existing platform-admin bypass.
async function resolveActorScope(actorUserId, currentCompanyId) {
  const actor = await portalUserRepository.findById(actorUserId);
  if (!actor) throw new ApiError(401, 'unauthenticated', 'Acting user not found');
  if (actor.is_platform_admin) return { isPlatformAdmin: true };

  const { odooConnectionId, partnerIds } = await odooContext.resolveUserManagementScope(actorUserId, currentCompanyId);
  return { isPlatformAdmin: false, odooConnectionId, partnerIds };
}

// Collapses "target doesn't exist" and "target exists but belongs to another customer" into the
// same 404 -- section 32 requires record-not-found responses to never confirm a record's
// existence outside the caller's own scope.
async function assertInScope(scope, targetUserId) {
  if (scope.isPlatformAdmin) return;
  const mappings = await identityMappingRepository.findByUser(targetUserId);
  const inScope = mappings.some(
    (m) => m.odoo_connection_id === scope.odooConnectionId && scope.partnerIds.includes(m.odoo_partner_id)
  );
  if (!inScope) throw new ApiError(404, 'not_found', 'User not found');
}

async function assignCompanies(userId, companyIds) {
  for (const [index, companyId] of companyIds.entries()) {
    await pool.query(
      `INSERT INTO portal_user_companies (user_id, odoo_company_id, is_default) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, odoo_company_id) DO UPDATE SET is_default = EXCLUDED.is_default`,
      [userId, companyId, index === 0]
    );
  }
}

// BUG-25: neither create() nor provisionFromOdoo() ever populated portal_user_companies unless a
// caller explicitly passed company_ids -- UsersPage.jsx's create form never did, and
// provisionFromOdoo() (webhook + syncUsers) had no parameter for it at all. A user landing with
// zero rows here isn't a transient "please pick one" state: GET /companies also reads from this
// table, so their company picker is empty too and switchCompany() 403s even if they somehow knew
// an id -- every Odoo-scoped endpoint 400s "Select a company first" with no self-service way out.
// This resolves the portal-native company id from the raw Odoo company id already available on
// the res.partner/res.users record, so provisioning can auto-assign it as the default company in
// the same transaction as everything else -- never throws, since Sync Companies may simply not
// have run yet for this connection (an unrelated admin step, not a reason to fail user creation).
async function resolveDefaultCompanyId(odooConnectionId, rawOdooCompanyId) {
  if (!rawOdooCompanyId) return null;
  const odooCompanyId = Array.isArray(rawOdooCompanyId) ? rawOdooCompanyId[0] : rawOdooCompanyId;
  const company = await odooCompanyRepository.findByConnectionAndOdooCompanyId(odooConnectionId, odooCompanyId);
  return company ? company.id : null;
}

// Creates the portal identity and, in the same call, validates that odoo_partner_id actually
// exists on the target connection -- section 22 requires ownership to trace back to a real
// res.partner before any transactional data can ever be served to this user.
//
// A non-platform-admin actor (Customer Admin) may only ever onboard teammates within their own
// customer organization: `odoo_connection_id`/`odoo_partner_id` are typed into the create-user
// form client-side (see UsersPage.jsx), so the server -- not the request -- is what must decide
// whether that partner is actually inside the acting admin's own scope (section 26, section 39).
async function create(actorUserId, currentCompanyId, input) {
  const scope = await resolveActorScope(actorUserId, currentCompanyId);
  if (!scope.isPlatformAdmin) {
    if (input.odooConnectionId !== scope.odooConnectionId || !scope.partnerIds.includes(input.odooPartnerId)) {
      throw new ApiError(403, 'out_of_scope', 'You can only create users within your own customer organization');
    }
  }

  const existing = await portalUserRepository.findByEmail(input.email);
  if (existing) throw new ApiError(409, 'email_taken', 'Email already registered');

  const roles = await portalRoleRepository.findByIds(input.roleIds);
  if (roles.length !== input.roleIds.length) {
    throw new ApiError(422, 'invalid_role', 'One or more role_ids do not exist');
  }

  const connection = await odooConnectionRepository.findById(input.odooConnectionId);
  if (!connection) throw new ApiError(422, 'invalid_connection', 'odoo_connection_id does not exist');
  // Migrasi 0015. Koneksi yang dimatikan tetap muncul di dropdown form ini (barisnya tidak hilang,
  // itu justru inti fiturnya), tapi memetakan user BARU ke sana berarti membuat akun yang tidak
  // bisa melihat apa pun sampai koneksinya dinyalakan lagi. Ditolak di server, bukan disaring di
  // frontend: pemetaan identitas adalah keputusan yang tidak pernah boleh ada di klien.
  if (connection.is_enabled === false) {
    throw new ApiError(422, 'connection_disabled', 'This Odoo connection is disabled; enable it before mapping new users to it');
  }
  const credential = crypto.decrypt(connection.encrypted_credential);
  const partner = await OdooPartnerService.findById(connection, credential, input.odooPartnerId);
  if (!partner) throw new ApiError(422, 'invalid_partner', 'odoo_partner_id was not found in Odoo');

  // No password is collected here -- the activation_token below (reusing the password-reset
  // flow) is how the new user sets their first password. Until then password_hash is unusable.
  const passwordHash = await bcrypt.hash(crypto.randomToken(16), 10);
  const user = await portalUserRepository.create({
    email: input.email,
    name: input.name || partner.name,
    passwordHash,
    status: 'pending_verification',
  });

  await portalUserRepository.assignRoles(user.id, input.roleIds);
  await identityMappingRepository.create({
    portalUserId: user.id,
    odooConnectionId: input.odooConnectionId,
    odooPartnerId: input.odooPartnerId,
  });

  if (input.companyIds && input.companyIds.length) {
    await assignCompanies(user.id, input.companyIds);
  } else {
    // BUG-25: UsersPage.jsx's create form has no company picker, so this is the only chance most
    // manually-created users ever get a default company -- fall back to whatever company the
    // partner itself belongs to in Odoo (already fetched above), instead of leaving them stuck.
    const defaultCompanyId = await resolveDefaultCompanyId(input.odooConnectionId, partner.company_id);
    if (defaultCompanyId) await assignCompanies(user.id, [defaultCompanyId]);
  }

  const activationToken = authService.generateResetToken(user.id);
  const link = `${env.appBaseUrl}/reset-password?token=${activationToken}`;
  await emailService.send({
    to: user.email,
    subject: 'Activate your Customer Portal account',
    text: `Welcome. Set your password to activate your account: ${link}`,
    html: `<p>Welcome to the Customer Portal.</p><p><a href="${link}">Set your password to activate your account</a></p>`,
  });

  const dto = await authService.toPublicUser(user);
  // Only echoed back when email delivery is the console fallback (no SMTP configured) -- once
  // real email is wired up, the activation token is never returned over the API.
  if (emailService.isConsoleFallback()) {
    dto.activation_token = activationToken;
  }
  return dto;
}

// Called by the Odoo webhook path (odooWebhookController), never by an HTTP-authenticated admin
// -- there is no actor/session here, this is a system-triggered event, so it skips
// resolveActorScope/assertInScope entirely (analogous to the platform-admin bypass: nobody's
// customer scope applies to "Odoo told us to provision this"). Auto-assigns the Viewer role (the
// same least-privilege role manually granted to aristya.r@outlook.com and aris.go.green@gmail.com
// earlier) so a newly-synced account is immediately usable exactly like those -- this was a
// deliberate choice to trade away the original "land with zero roles for manual review" design in
// favor of full automation; if the Viewer role catalog entry is ever renamed/removed, this falls
// back to zero roles rather than failing the whole provisioning.
// Returns a status instead of throwing for the two "nothing to do" cases, since a webhook caller
// retries on non-2xx and neither case is an error.
// odooCompanyId (BUG-25) is optional -- the webhook payload schema doesn't require it (Odoo
// admins wire up whatever fields they picked when configuring the automation rule), so a webhook
// call that doesn't send it just leaves the new user unassigned exactly like before this fix,
// rather than failing. syncUsers() (CR-039) always has it, since it comes straight off the same
// res.users record as everything else being provisioned.
async function provisionFromOdoo({ odooConnectionId, odooPartnerId, email, name, odooCompanyId }) {
  const existingMapping = await identityMappingRepository.findByConnectionAndPartner(odooConnectionId, odooPartnerId);
  if (existingMapping) {
    const user = await portalUserRepository.findById(existingMapping.portal_user_id);
    return { status: 'already_provisioned', user: await authService.toPublicUser(user) };
  }

  const existingUser = await portalUserRepository.findByEmail(email);
  if (existingUser) {
    // This email already belongs to a portal user with a different (or no) identity mapping on
    // this connection/partner -- provisioning onto it anyway would risk attaching someone else's
    // Odoo identity to an existing account. Surfaced via audit log for a human to resolve.
    return { status: 'skipped_conflict', user: await authService.toPublicUser(existingUser) };
  }

  const passwordHash = await bcrypt.hash(crypto.randomToken(16), 10);
  const user = await portalUserRepository.create({
    email,
    name: name || `Odoo partner ${odooPartnerId}`,
    passwordHash,
    status: 'pending_verification',
  });
  await identityMappingRepository.create({ portalUserId: user.id, odooConnectionId, odooPartnerId });

  const defaultCompanyId = await resolveDefaultCompanyId(odooConnectionId, odooCompanyId);
  if (defaultCompanyId) await assignCompanies(user.id, [defaultCompanyId]);

  const viewerRole = await portalRoleRepository.findByName('Viewer');
  if (viewerRole) await portalUserRepository.assignRoles(user.id, [viewerRole.id]);

  const activationToken = authService.generateResetToken(user.id);
  const link = `${env.appBaseUrl}/reset-password?token=${activationToken}`;
  await emailService.send({
    to: user.email,
    subject: 'Activate your Customer Portal account',
    text: `Welcome. Set your password to activate your account: ${link}`,
    html: `<p>Welcome to the Customer Portal.</p><p><a href="${link}">Set your password to activate your account</a></p>`,
  });

  return { status: 'provisioned', user: await authService.toPublicUser(user) };
}

async function get(actorUserId, currentCompanyId, id) {
  const scope = await resolveActorScope(actorUserId, currentCompanyId);
  await assertInScope(scope, id);
  const user = await portalUserRepository.findById(id);
  if (!user) throw new ApiError(404, 'not_found', 'User not found');
  return authService.toPublicUser(user);
}

async function list(actorUserId, currentCompanyId, { page = 1, pageSize = 20, status }) {
  const scope = await resolveActorScope(actorUserId, currentCompanyId);
  const { rows, total } = await portalUserRepository.list({
    page,
    pageSize,
    status,
    scope: scope.isPlatformAdmin ? null : { odooConnectionId: scope.odooConnectionId, partnerIds: scope.partnerIds },
  });
  const data = await Promise.all(rows.map((u) => authService.toPublicUser(u)));
  return { data, meta: { page, page_size: pageSize, total } };
}

async function update(actorUserId, currentCompanyId, id, patch) {
  const scope = await resolveActorScope(actorUserId, currentCompanyId);
  await assertInScope(scope, id);

  const dbPatch = {};
  if (patch.name) dbPatch.name = patch.name;
  if (patch.status) dbPatch.status = patch.status;
  const user = await portalUserRepository.update(id, dbPatch);
  if (!user) throw new ApiError(404, 'not_found', 'User not found');
  if (patch.roleIds) await portalUserRepository.assignRoles(id, patch.roleIds);
  return authService.toPublicUser(user);
}

async function disable(actorUserId, currentCompanyId, id) {
  const scope = await resolveActorScope(actorUserId, currentCompanyId);
  await assertInScope(scope, id);

  const user = await portalUserRepository.update(id, { status: 'disabled' });
  if (!user) throw new ApiError(404, 'not_found', 'User not found');
}

module.exports = { create, provisionFromOdoo, get, list, update, disable };

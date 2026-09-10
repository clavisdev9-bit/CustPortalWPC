const ApiError = require('../utils/ApiError');
const portalUserRepository = require('../repositories/portalUserRepository');

// Odoo connection config and the cross-tenant audit log are platform-operator concerns, not
// something a Customer Admin role should reach -- kept separate from portal_roles/permissions,
// which model per-customer RBAC, not platform operations.
module.exports = async function requirePlatformAdmin(req, res, next) {
  try {
    const user = await portalUserRepository.findById(req.user.id);
    if (!user || !user.is_platform_admin) {
      throw new ApiError(403, 'forbidden', 'Platform admin access required');
    }
    next();
  } catch (err) {
    next(err);
  }
};

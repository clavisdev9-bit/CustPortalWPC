const ApiError = require('../utils/ApiError');
const portalUserRepository = require('../repositories/portalUserRepository');

// A platform admin operates the SaaS itself and bypasses per-customer RBAC entirely, the same
// way a superuser bypasses ACLs -- otherwise every new deployment needs a bootstrap role
// assignment just so its own operator can use the API.
function requirePermission(code) {
  return async (req, res, next) => {
    try {
      const user = await portalUserRepository.findById(req.user.id);
      if (user && user.is_platform_admin) return next();

      const permissions = await portalUserRepository.getPermissionCodes(req.user.id);
      if (!permissions.includes(code)) {
        throw new ApiError(403, 'forbidden', `Missing permission: ${code}`);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = requirePermission;

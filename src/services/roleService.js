const portalRoleRepository = require('../repositories/portalRoleRepository');
const ApiError = require('../utils/ApiError');

async function toDto(role) {
  const permissions = await portalRoleRepository.getPermissions(role.id);
  return { id: role.id, name: role.name, description: role.description, status: role.status, permissions };
}

async function list() {
  const roles = await portalRoleRepository.list();
  return Promise.all(roles.map(toDto));
}

async function get(id) {
  const role = await portalRoleRepository.findById(id);
  if (!role) throw new ApiError(404, 'not_found', 'Role not found');
  return toDto(role);
}

async function create({ name, description, permissionCodes = [] }) {
  const role = await portalRoleRepository.create({ name, description });
  if (permissionCodes.length) await portalRoleRepository.setPermissions(role.id, permissionCodes);
  return toDto(role);
}

async function update(id, { description, permissionCodes }) {
  const role = await portalRoleRepository.update(id, { description });
  if (!role) throw new ApiError(404, 'not_found', 'Role not found');
  if (permissionCodes) await portalRoleRepository.setPermissions(id, permissionCodes);
  return toDto(role);
}

async function remove(id) {
  const usageCount = await portalRoleRepository.countUsers(id);
  if (usageCount > 0) throw new ApiError(409, 'role_in_use', 'Role is still assigned to users');
  await portalRoleRepository.remove(id);
}

module.exports = { list, get, create, update, remove };

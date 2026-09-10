const asyncHandler = require('../utils/asyncHandler');
const roleService = require('../services/roleService');
const permissionRepository = require('../repositories/permissionRepository');
const { createRoleSchema, updateRoleSchema } = require('../validators/roleValidators');

const list = asyncHandler(async (req, res) => res.json(await roleService.list()));

const create = asyncHandler(async (req, res) => {
  const body = createRoleSchema.parse(req.body);
  const role = await roleService.create({
    name: body.name,
    description: body.description,
    permissionCodes: body.permission_codes,
  });
  res.status(201).json(role);
});

const get = asyncHandler(async (req, res) => res.json(await roleService.get(req.params.id)));

const update = asyncHandler(async (req, res) => {
  const body = updateRoleSchema.parse(req.body);
  res.json(
    await roleService.update(req.params.id, { description: body.description, permissionCodes: body.permission_codes })
  );
});

const remove = asyncHandler(async (req, res) => {
  await roleService.remove(req.params.id);
  res.status(204).end();
});

const listPermissions = asyncHandler(async (req, res) => res.json(await permissionRepository.list()));

module.exports = { list, create, get, update, remove, listPermissions };

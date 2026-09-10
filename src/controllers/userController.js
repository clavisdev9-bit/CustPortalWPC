const asyncHandler = require('../utils/asyncHandler');
const userService = require('../services/userService');
const auditService = require('../services/auditService');
const { createUserSchema, updateUserSchema, listUsersQuerySchema } = require('../validators/userValidators');

const list = asyncHandler(async (req, res) => {
  const query = listUsersQuerySchema.parse(req.query);
  res.json(await userService.list(req.user.id, req.user.currentCompanyId, query));
});

const create = asyncHandler(async (req, res) => {
  const body = createUserSchema.parse(req.body);
  const user = await userService.create(req.user.id, req.user.currentCompanyId, {
    email: body.email,
    name: body.name,
    odooConnectionId: body.odoo_connection_id,
    odooPartnerId: body.odoo_partner_id,
    roleIds: body.role_ids,
    companyIds: body.company_ids,
  });
  await auditService.record(req, { action: 'user.create', targetType: 'portal_user', targetId: user.id });
  res.status(201).json(user);
});

const get = asyncHandler(async (req, res) => {
  res.json(await userService.get(req.user.id, req.user.currentCompanyId, req.params.id));
});

const update = asyncHandler(async (req, res) => {
  const body = updateUserSchema.parse(req.body);
  const user = await userService.update(req.user.id, req.user.currentCompanyId, req.params.id, {
    name: body.name,
    status: body.status,
    roleIds: body.role_ids,
  });
  await auditService.record(req, { action: 'user.update', targetType: 'portal_user', targetId: req.params.id });
  res.json(user);
});

const disable = asyncHandler(async (req, res) => {
  await userService.disable(req.user.id, req.user.currentCompanyId, req.params.id);
  await auditService.record(req, { action: 'user.disable', targetType: 'portal_user', targetId: req.params.id });
  res.status(204).end();
});

module.exports = { list, create, get, update, disable };

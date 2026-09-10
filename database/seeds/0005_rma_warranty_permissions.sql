INSERT INTO portal_permissions (code, name, module) VALUES
  ('rma.view', 'View RMA requests', 'rma'),
  ('rma.create', 'Create RMA requests', 'rma'),
  ('warranty.view', 'View warranty claims', 'warranty'),
  ('warranty.create', 'Create warranty claims', 'warranty');

-- Section 6 only lists RMA/Warranty under Customer Admin.
INSERT INTO portal_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM portal_roles r, portal_permissions p
WHERE r.name = 'Customer Admin' AND p.code IN ('rma.view', 'rma.create', 'warranty.view', 'warranty.create');

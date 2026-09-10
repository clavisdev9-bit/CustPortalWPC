INSERT INTO portal_permissions (code, name, module) VALUES
  ('maintenance.view', 'View scheduled maintenance requests', 'maintenance');

-- Same scoping as Helpdesk/RMA/Warranty (0004/0005): After Sales features are Customer Admin-only
-- until a future CR asks otherwise.
INSERT INTO portal_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM portal_roles r, portal_permissions p
WHERE r.name = 'Customer Admin' AND p.code = 'maintenance.view';

-- Seed data for Phase 1: permission catalog (section 5) and default roles (section 6).
-- Only permissions for modules that exist in Phase 1 (user management) are seeded here.
-- invoice.*, quotation.*, order.*, ticket.* are illustrative in the spec (section 5) but
-- belong to modules shipped in later phases -- seed them alongside those phases' migrations,
-- then wire them into portal_role_permissions.

INSERT INTO portal_permissions (code, name, module) VALUES
  ('user.view',    'View portal users',    'user'),
  ('user.create',  'Create portal users',  'user'),
  ('user.disable', 'Disable portal users', 'user');

INSERT INTO portal_roles (name, description) VALUES
  ('Customer Admin', 'Manages portal users for their company; full self-service access'),
  ('Finance',         'Invoice, payment and credit visibility'),
  ('Procurement',     'Product, quotation and order management'),
  ('Viewer',          'Read-only access to quotations, orders, invoices, deliveries and documents');

-- Customer Admin is the only Phase 1 role with user-management rights.
INSERT INTO portal_role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM portal_roles r, portal_permissions p
WHERE r.name = 'Customer Admin'
  AND p.code IN ('user.view', 'user.create', 'user.disable');

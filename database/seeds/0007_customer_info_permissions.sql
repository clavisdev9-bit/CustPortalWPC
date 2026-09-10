-- Permissions for Company Profile / Addresses / Contacts-PIC (CR
-- customer_portal_odoo18_customer_scoped_access.md, sections 10-12, 20).

INSERT INTO portal_permissions (code, name, module) VALUES
  ('profile.view', 'View company profile', 'profile'),
  ('address.view', 'View company addresses', 'address'),
  ('contact.view', 'View company contacts/PIC', 'contact');

-- Section 20's permission matrix marks these read-only across every role (Viewer, Customer
-- Admin, Finance) -- Procurement gets the same baseline informational access already given for
-- quotation/order/delivery view (0002_phase2to4_permissions.sql).
INSERT INTO portal_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM portal_roles r, portal_permissions p
WHERE r.name IN ('Customer Admin', 'Finance', 'Procurement', 'Viewer')
  AND p.code IN ('profile.view', 'address.view', 'contact.view');

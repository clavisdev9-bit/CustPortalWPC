INSERT INTO portal_permissions (code, name, module) VALUES
  ('order.comment', 'Post comments on a sales order''s communication history', 'order');

-- Same roles as the other order write action (reorder) -- Finance and Viewer stay read-only.
INSERT INTO portal_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM portal_roles r, portal_permissions p
WHERE r.name IN ('Customer Admin', 'Procurement') AND p.code = 'order.comment';

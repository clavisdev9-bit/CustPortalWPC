INSERT INTO portal_permissions (code, name, module) VALUES
  ('quotation.comment', 'Post comments on a quotation''s communication history', 'quotation');

-- Same roles as the other quotation write actions (approve/reject/sign) -- Finance and Viewer stay read-only.
INSERT INTO portal_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM portal_roles r, portal_permissions p
WHERE r.name IN ('Customer Admin', 'Procurement') AND p.code = 'quotation.comment';

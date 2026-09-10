-- Option B document sharing: permissions + a dedicated internal sender role (section 18).

INSERT INTO portal_permissions (code, name, module) VALUES
  ('document.share',   'Share documents to specific customers', 'document'),
  ('document.receive', 'View documents shared with me',         'document');

-- Internal vendor staff/sales who push confidential files out to specific customers. This is NOT a
-- customer self-service role: because its recipient targeting is per-individual partner (and the
-- sender is deliberately allowed to target any partner in the connection), it must be granted only
-- to trusted internal users.
INSERT INTO portal_roles (name, description) VALUES
  ('Staff (Internal)', 'Internal vendor staff; can share documents to specific customers');

INSERT INTO portal_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM portal_roles r, portal_permissions p
WHERE r.name = 'Staff (Internal)' AND p.code = 'document.share';

-- Every customer-side role can view the documents shared with them.
INSERT INTO portal_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM portal_roles r, portal_permissions p
WHERE r.name IN ('Customer Admin', 'Finance', 'Procurement', 'Viewer')
  AND p.code = 'document.receive';

INSERT INTO portal_permissions (code, name, module) VALUES
  ('quotation.sign', 'E-sign and confirm a quotation', 'quotation'),
  ('product.view', 'View product catalog and purchase history', 'product');

-- Customer Admin: full access
INSERT INTO portal_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM portal_roles r, portal_permissions p
WHERE r.name = 'Customer Admin' AND p.code IN ('quotation.sign', 'product.view');

-- Procurement: full quotation workflow + product catalog (section 6: "Product ✓")
INSERT INTO portal_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM portal_roles r, portal_permissions p
WHERE r.name = 'Procurement' AND p.code IN ('quotation.sign', 'product.view');

INSERT INTO portal_permissions (code, name, module) VALUES
  ('quotation.view', 'View quotations', 'quotation'),
  ('quotation.approve', 'Approve quotations', 'quotation'),
  ('quotation.reject', 'Reject quotations', 'quotation'),
  ('order.view', 'View sales orders', 'order'),
  ('order.reorder', 'Reorder a past sales order', 'order'),
  ('invoice.view', 'View invoices', 'invoice'),
  ('invoice.download', 'Download invoice PDF', 'invoice'),
  ('invoice.pay', 'Pay invoices online', 'invoice'),
  ('delivery.view', 'View deliveries', 'delivery'),
  ('delivery.confirm', 'Confirm delivery receipt', 'delivery'),
  ('request.create', 'Submit product/quotation requests', 'request'),
  ('request.view', 'View submitted requests', 'request');

-- Customer Admin: full access (section 6)
INSERT INTO portal_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM portal_roles r, portal_permissions p
WHERE r.name = 'Customer Admin'
  AND p.code IN (
    'quotation.view', 'quotation.approve', 'quotation.reject',
    'order.view', 'order.reorder',
    'invoice.view', 'invoice.download', 'invoice.pay',
    'delivery.view', 'delivery.confirm',
    'request.create', 'request.view'
  );

-- Finance: invoice/payment focused, view-only on sales (section 6)
INSERT INTO portal_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM portal_roles r, portal_permissions p
WHERE r.name = 'Finance'
  AND p.code IN ('invoice.view', 'invoice.download', 'invoice.pay', 'order.view', 'quotation.view');

-- Procurement: full sales/delivery workflow, invoice view-only (section 6)
INSERT INTO portal_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM portal_roles r, portal_permissions p
WHERE r.name = 'Procurement'
  AND p.code IN (
    'quotation.view', 'quotation.approve', 'quotation.reject',
    'order.view', 'order.reorder',
    'delivery.view', 'delivery.confirm',
    'invoice.view', 'request.create', 'request.view'
  );

-- Viewer: read-only across the board (section 6)
INSERT INTO portal_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM portal_roles r, portal_permissions p
WHERE r.name = 'Viewer'
  AND p.code IN ('quotation.view', 'order.view', 'invoice.view', 'delivery.view');

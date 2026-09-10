INSERT INTO portal_permissions (code, name, module) VALUES
  ('subscription.view', 'View subscriptions', 'subscription'),
  ('subscription.manage', 'Request renew/upgrade/downgrade/close on a subscription', 'subscription');

-- Section 6 only lists Subscription under Customer Admin.
INSERT INTO portal_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM portal_roles r, portal_permissions p
WHERE r.name = 'Customer Admin' AND p.code IN ('subscription.view', 'subscription.manage');

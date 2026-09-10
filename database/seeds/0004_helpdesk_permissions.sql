INSERT INTO portal_permissions (code, name, module) VALUES
  ('ticket.view', 'View helpdesk tickets', 'ticket'),
  ('ticket.create', 'Create helpdesk tickets', 'ticket'),
  ('ticket.reply', 'Reply to and attach files on helpdesk tickets', 'ticket'),
  ('ticket.close', 'Close/reopen helpdesk tickets', 'ticket');

-- Section 6 only lists Helpdesk under Customer Admin -- Finance/Procurement/Viewer get nothing here.
INSERT INTO portal_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM portal_roles r, portal_permissions p
WHERE r.name = 'Customer Admin' AND p.code IN ('ticket.view', 'ticket.create', 'ticket.reply', 'ticket.close');

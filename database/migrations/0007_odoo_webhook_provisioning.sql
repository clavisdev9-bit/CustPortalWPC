-- Odoo -> Portal automatic user provisioning (webhook)
--
-- Odoo's built-in Automation Rules feature can POST a webhook notification the moment a contact
-- is granted Portal Access, but its "Send a Webhook Notification" action has no field for custom
-- HTTP headers -- it can only POST to a configured URL. So the shared secret that authenticates
-- an inbound call as genuinely coming from a specific Odoo connection has to travel in the URL
-- path itself (see src/routes/odooWebhooks.routes.js), not a header.

ALTER TABLE odoo_connections ADD COLUMN webhook_secret TEXT;

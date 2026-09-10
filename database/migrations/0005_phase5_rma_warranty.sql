-- Phase 5 (partial) -- RMA & Warranty stopgap.
--
-- These do NOT get a dedicated Odoo model of their own -- that needs the custom portal_rma /
-- portal_warranty addons from section 27, which means deploying Python code to the target
-- Odoo, out of reach here. Instead, each claim is recorded here AND mirrored into Odoo as a
-- helpdesk.ticket, so staff can work it through Odoo's existing Helpdesk pipeline.
--
-- Deliberately no local "status" column: the customer-facing status is always read live from
-- the linked ticket's stage (see rmaService.js / warrantyService.js), never cached here, so it
-- can never go stale relative to what staff actually did in Odoo.

CREATE TABLE rma_requests (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id     UUID NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  odoo_connection_id UUID NOT NULL REFERENCES odoo_connections(id),
  odoo_order_id      INTEGER,                 -- sale.order id this RMA concerns, if given
  odoo_ticket_id     INTEGER NOT NULL,        -- linked helpdesk.ticket -- the actual workflow lives here
  reason             TEXT NOT NULL,
  requested_action   VARCHAR(20) NOT NULL CHECK (requested_action IN ('refund', 'replacement')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_rma_requests_user ON rma_requests (portal_user_id, created_at DESC);

CREATE TABLE warranty_claims (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id     UUID NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  odoo_connection_id UUID NOT NULL REFERENCES odoo_connections(id),
  serial_number      VARCHAR(100) NOT NULL,
  odoo_ticket_id     INTEGER NOT NULL,
  issue_description  TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_warranty_claims_user ON warranty_claims (portal_user_id, created_at DESC);

-- Phase 4 -- Fulfillment
-- Delivery data itself is read-through from Odoo (OdooDeliveryService, stock.picking).
-- A confirmation is a portal-originated event pushed into Odoo as a chatter note/attachment
-- (see deliveryService.confirmDelivery) -- this table is the local record of that push, kept
-- for fast reads and as a fallback if the Odoo-side write itself fails partway.

CREATE TABLE delivery_confirmations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id       UUID NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  odoo_connection_id   UUID NOT NULL REFERENCES odoo_connections(id),
  odoo_picking_id      INTEGER NOT NULL,        -- stock.picking id in Odoo
  notes                TEXT,
  signature_file_path  TEXT,                    -- local disk for now; same caveat as payment_proofs
  odoo_synced_at       TIMESTAMPTZ,             -- set once the confirmation is pushed to Odoo as a note
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_delivery_confirmations_picking ON delivery_confirmations (odoo_connection_id, odoo_picking_id);

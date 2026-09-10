-- Phase 2 -- Core Customer Portal
-- Quotation/Order/Invoice/Document stay Odoo-only (read-through via OdooSalesService /
-- OdooInvoiceService / OdooAttachmentService) -- only what's genuinely portal-domain is stored here.

-- "Request Product" / "Request Quotation" (section 13, marked as a customer-initiated ask that
-- doesn't correspond to an existing Odoo record yet).
CREATE TABLE customer_requests (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id     UUID NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  odoo_connection_id UUID NOT NULL REFERENCES odoo_connections(id),
  type               VARCHAR(30) NOT NULL CHECK (type IN ('request_product', 'request_quotation')),
  payload            JSONB NOT NULL,
  status             VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'closed')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_customer_requests_user ON customer_requests (portal_user_id, created_at DESC);

CREATE TRIGGER trg_customer_requests_updated_at
  BEFORE UPDATE ON customer_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- In-app notification feed (section 29). Populated synchronously by portal actions (e.g.
-- "quotation approved"); change-detection on Odoo-side events is Phase 7's Real-time Notification.
CREATE TABLE notifications (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id UUID NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  type           VARCHAR(50) NOT NULL,
  title          VARCHAR(200) NOT NULL,
  body           TEXT,
  link           VARCHAR(255),
  read_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_notifications_user_unread ON notifications (portal_user_id, read_at, created_at DESC);

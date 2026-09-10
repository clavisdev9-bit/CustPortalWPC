-- Phase 3 -- Payment
-- Online payment itself is Odoo's Payment Link wizard (OdooPaymentService) -- section 28
-- explicitly rules out building a payment engine here. Payment proof upload IS portal-domain:
-- it is a manual/bank-transfer confirmation workflow Odoo doesn't model on its own.

CREATE TABLE payment_proofs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id     UUID NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  odoo_connection_id UUID NOT NULL REFERENCES odoo_connections(id),
  odoo_invoice_id    INTEGER NOT NULL,          -- account.move id in Odoo
  file_path          TEXT NOT NULL,             -- local disk for now; swap for object storage before production
  original_filename  VARCHAR(255) NOT NULL,
  mime_type          VARCHAR(100) NOT NULL,
  amount             NUMERIC(14, 2),            -- customer-declared amount paid
  status             VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
  reviewer_note       TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_payment_proofs_user ON payment_proofs (portal_user_id, created_at DESC);
CREATE INDEX ix_payment_proofs_invoice ON payment_proofs (odoo_connection_id, odoo_invoice_id);

CREATE TRIGGER trg_payment_proofs_updated_at
  BEFORE UPDATE ON payment_proofs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

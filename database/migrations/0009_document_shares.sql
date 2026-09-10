-- Option B document sharing (staff -> customer), spec section 18 "Document Management".
--
-- The PORTAL is the access authority (not Odoo's own portal ACL, which this app bypasses because
-- it talks to Odoo via a single connection-level service credential -- see OdooAuthService.openSession).
-- A file is delivered to exactly ONE Odoo res.partner (recipient_partner_id), and only portal users
-- whose identity_mapping resolves to that same partner *in the same connection* can list/download it.
-- This is the same partner+connection scoping rule already enforced for rma_requests and
-- customer_requests (resolution.md BUG-08 / BUG-13). Per the design decision for this feature the
-- match is per-INDIVIDUAL (exact recipient_partner_id) -- no commercial_partner_id family expansion.
--
-- Bytes themselves live in ir.attachment on res.partner (an Odoo *base* model), so this needs no
-- Odoo Documents Enterprise app. This table is the share metadata + audit anchor.

CREATE TABLE document_shares (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  odoo_connection_id   UUID NOT NULL REFERENCES odoo_connections(id) ON DELETE CASCADE,
  recipient_partner_id INTEGER NOT NULL,        -- res.partner id of the intended recipient (exact, no family)
  odoo_attachment_id   INTEGER NOT NULL,        -- ir.attachment holding the bytes (res_model='res.partner')
  filename             TEXT NOT NULL,
  mimetype             VARCHAR(255),
  size_bytes           BIGINT,
  category             VARCHAR(50),             -- optional taxonomy: Contract / Invoice / POD / ...
  note                 TEXT,
  shared_by_user_id    UUID REFERENCES portal_users(id) ON DELETE SET NULL,
  expires_at           TIMESTAMPTZ,             -- optional: hide after this instant
  revoked_at           TIMESTAMPTZ,             -- optional: soft-revoke without deleting the audit row
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Recipient inbox lookup: filtered by (connection, partner) on every access.
CREATE INDEX ix_document_shares_recipient
  ON document_shares (odoo_connection_id, recipient_partner_id, created_at DESC);

-- Sender's "what have I shared" list (accountability).
CREATE INDEX ix_document_shares_sender
  ON document_shares (shared_by_user_id, created_at DESC);

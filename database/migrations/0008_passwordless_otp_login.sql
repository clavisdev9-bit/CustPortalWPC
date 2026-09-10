-- Passwordless email-OTP login (Docs/CR/customer_portal_passwordless_otp_login.md)
--
-- Additive alongside the existing password/2FA/SSO login paths (section 2.5, 14 of that CR) --
-- portal_users, sessions and refresh_tokens are unchanged and reused as-is. This table only
-- tracks the lifecycle of the short-lived login code itself.

CREATE TABLE otp_tokens (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id UUID NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  token_hash     TEXT NOT NULL,          -- sha256 of the plaintext code; the code itself is never stored
  status         VARCHAR(20) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'verified', 'expired', 'superseded', 'locked')),
  attempt_count  SMALLINT NOT NULL DEFAULT 0,
  ip_address     INET,
  user_agent     TEXT,
  expires_at     TIMESTAMPTZ NOT NULL,
  verified_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Finds "the current pending code for this user" and, combined with created_at, backs the
-- request-rate-limit window count (section 6 of the CR).
CREATE INDEX ix_otp_tokens_user_status ON otp_tokens (portal_user_id, status);
CREATE INDEX ix_otp_tokens_user_created ON otp_tokens (portal_user_id, created_at);

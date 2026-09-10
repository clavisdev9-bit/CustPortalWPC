-- Phase 1 -- Foundation
-- Scope: Authentication, User Management, RBAC, Odoo Connection,
-- Odoo Connector mapping, Company Selection, Audit Log.
--
-- Tables for later phases (customer_requests, rma_requests, warranty_claims,
-- payment_proofs, notifications, ...) are intentionally NOT created here --
-- they ship in their own phase's migration, next to the feature that needs them.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Odoo Connection Management (section 9)
-- ---------------------------------------------------------------------------

CREATE TABLE odoo_connections (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   VARCHAR(100) NOT NULL,
  url                    VARCHAR(255) NOT NULL,
  database               VARCHAR(100) NOT NULL,
  username               VARCHAR(255) NOT NULL,
  auth_type              VARCHAR(20) NOT NULL CHECK (auth_type IN ('password', 'api_key')),
  encrypted_credential   TEXT NOT NULL,        -- password or api key, encrypted at rest (never plaintext)
  encryption_key_version SMALLINT NOT NULL DEFAULT 1,
  odoo_version           VARCHAR(20),          -- populated after a successful common.version() check
  status                 VARCHAR(20) NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'connected', 'error', 'disabled')),
  last_checked_at        TIMESTAMPTZ,
  last_error             TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_odoo_connections_updated_at
  BEFORE UPDATE ON odoo_connections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- res.company records pulled from a given connection ("Get Companies" step, section 9)
CREATE TABLE odoo_companies (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  odoo_connection_id UUID NOT NULL REFERENCES odoo_connections(id) ON DELETE CASCADE,
  odoo_company_id   INTEGER NOT NULL,   -- res.company id inside that Odoo database
  name              VARCHAR(150) NOT NULL,
  currency          VARCHAR(10),
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (odoo_connection_id, odoo_company_id)
);

CREATE TRIGGER trg_odoo_companies_updated_at
  BEFORE UPDATE ON odoo_companies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- RBAC (sections 4-6)
-- ---------------------------------------------------------------------------

CREATE TABLE portal_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL UNIQUE,   -- e.g. 'Customer Admin', 'Finance'
  description TEXT,
  status      VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_portal_roles_updated_at
  BEFORE UPDATE ON portal_roles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE portal_permissions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code       VARCHAR(100) NOT NULL UNIQUE,    -- e.g. 'invoice.view'
  name       VARCHAR(150) NOT NULL,
  module     VARCHAR(50) NOT NULL,            -- e.g. 'invoice', 'quotation', 'user'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE portal_role_permissions (
  role_id       UUID NOT NULL REFERENCES portal_roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES portal_permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- ---------------------------------------------------------------------------
-- Portal Users (sections 5, 8)
-- ---------------------------------------------------------------------------

CREATE TABLE portal_users (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                  VARCHAR(255) NOT NULL,
  password_hash          TEXT NOT NULL,          -- Argon2id / bcrypt, never plaintext
  name                   VARCHAR(150) NOT NULL,
  status                 VARCHAR(20) NOT NULL DEFAULT 'pending_verification'
                           CHECK (status IN ('active', 'disabled', 'pending_verification')),
  is_platform_admin      BOOLEAN NOT NULL DEFAULT false,  -- operates the SaaS itself; distinct from customer RBAC roles
  two_factor_enabled     BOOLEAN NOT NULL DEFAULT false,
  two_factor_secret      TEXT,                   -- encrypted TOTP secret, set once 2FA is enabled
  failed_login_attempts  SMALLINT NOT NULL DEFAULT 0,
  locked_until           TIMESTAMPTZ,
  last_login_at          TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- case-insensitive uniqueness without requiring the citext extension
CREATE UNIQUE INDEX ux_portal_users_email ON portal_users (lower(email));

CREATE TRIGGER trg_portal_users_updated_at
  BEFORE UPDATE ON portal_users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE portal_user_roles (
  user_id UUID NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES portal_roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

-- Which companies (section 23) a user is allowed to switch into
CREATE TABLE portal_user_companies (
  user_id         UUID NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  odoo_company_id UUID NOT NULL REFERENCES odoo_companies(id) ON DELETE CASCADE,
  is_default      BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, odoo_company_id)
);

-- Ensures only one default company per user
CREATE UNIQUE INDEX ux_portal_user_companies_default
  ON portal_user_companies (user_id) WHERE is_default;

-- Maps a portal identity to its res.partner record on a given Odoo connection.
-- Kept as its own table (rather than columns on portal_users) so multi-Odoo
-- (section 24) is a data change, not a schema migration.
CREATE TABLE identity_mappings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id     UUID NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  odoo_connection_id UUID NOT NULL REFERENCES odoo_connections(id) ON DELETE CASCADE,
  odoo_partner_id    INTEGER NOT NULL,   -- res.partner id
  odoo_user_id       INTEGER,            -- res.users id, only if the customer also has an Odoo login
  is_primary         BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (portal_user_id, odoo_connection_id),
  UNIQUE (odoo_connection_id, odoo_partner_id)
);

-- ---------------------------------------------------------------------------
-- Sessions & refresh tokens (section 8)
-- ---------------------------------------------------------------------------

CREATE TABLE sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  current_company_id UUID REFERENCES odoo_companies(id),   -- active company for this session (section 23)
  ip_address         INET,
  user_agent         TEXT,
  status             VARCHAR(20) NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'revoked', 'expired')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at         TIMESTAMPTZ NOT NULL,
  revoked_at         TIMESTAMPTZ
);

CREATE INDEX ix_sessions_user_id ON sessions (user_id);

CREATE TABLE refresh_tokens (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  token_hash     TEXT NOT NULL UNIQUE,   -- sha256 of the token; raw token never stored
  status         VARCHAR(20) NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'rotated', 'revoked')),
  rotated_to_id  UUID REFERENCES refresh_tokens(id),
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_refresh_tokens_session_id ON refresh_tokens (session_id);

-- ---------------------------------------------------------------------------
-- Audit log (section 22) -- append-only, high write volume
-- ---------------------------------------------------------------------------

CREATE TABLE audit_logs (
  id             BIGSERIAL PRIMARY KEY,
  actor_user_id  UUID REFERENCES portal_users(id) ON DELETE SET NULL,
  action         VARCHAR(100) NOT NULL,   -- e.g. 'auth.login', 'user.create', 'role.assign'
  target_type    VARCHAR(50),             -- e.g. 'portal_user', 'odoo_connection'
  target_id      VARCHAR(100),
  metadata       JSONB,
  ip_address     INET,
  user_agent     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_audit_logs_actor_created ON audit_logs (actor_user_id, created_at DESC);
CREATE INDEX ix_audit_logs_action_created ON audit_logs (action, created_at DESC);

-- Phase 7 -- Real-time notification (request-driven, throttled).
-- Tracks the last time each identity mapping's Odoo-side changes were checked, so
-- notificationService.checkForUpdates() can do a bounded "what changed since last time" read
-- instead of scanning full history on every poll. DEFAULT now() means a freshly created mapping
-- starts checking from the moment it exists, not from Odoo's full history.
ALTER TABLE identity_mappings ADD COLUMN last_polled_at TIMESTAMPTZ NOT NULL DEFAULT now();

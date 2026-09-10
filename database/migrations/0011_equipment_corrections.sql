-- Customer Population (installed base) sepenuhnya hidup di Odoo -- lihat CR
-- customer_population_installed_base.md D-2. Tabel ini SENGAJA bukan salinan registry: ia hanya
-- antrean permintaan koreksi dari pelanggan, karena pelanggan tidak boleh menulis langsung ke
-- master data aset. Sama seperti rma_requests, workflow-nya hidup di helpdesk.ticket yang tertaut,
-- dan status TIDAK pernah dicache di sini supaya tidak bisa basi terhadap apa yang staf kerjakan.
--
-- Scoping mengikuti aturan repo: portal_user_id DAN odoo_connection_id, karena satu user bisa
-- punya mapping ke lebih dari satu Odoo.

CREATE TABLE equipment_corrections (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id     UUID NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  odoo_connection_id UUID NOT NULL REFERENCES odoo_connections(id),
  odoo_equipment_id  INTEGER NOT NULL,       -- maintenance.equipment yang dikoreksi
  odoo_ticket_id     INTEGER NOT NULL,       -- workflow-nya hidup di sini
  correction_type    VARCHAR(30) NOT NULL
    CHECK (correction_type IN ('location', 'status', 'runtime_hours', 'ownership', 'other')),
  proposed_value     TEXT NOT NULL,          -- nilai usulan, apa adanya; staf yang menerjemahkan
  note               TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_equipment_corrections_user
  ON equipment_corrections (portal_user_id, created_at DESC);

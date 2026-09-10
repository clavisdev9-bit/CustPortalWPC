# Odoo Field Provisioning — Customer Population (Installed Base)

- **Status**: **superseded 2026-08-30**. This document originally specified manual Odoo Studio
  field creation, assuming Q-3 (CR `Docs/CR/customer_population_installed_base.md` §2.4) would
  default to "Studio only." That turned out to be wrong for this target: a real addon repo for
  PT Dira already exists and is actively deployed to (`odoo18_1/ODOO_STAGING_PT_DIRA`, pushed to
  `github.com/clavisdev9-bit/ODOO_STAGING_PT_DIRA`), so Q-3 resolves to **"addon deployment is
  available."** Per D-2, that changes the mechanism (real Python fields instead of Studio's
  `x_studio_`-prefixed ones) while leaving the rest of the CR's design intact.
- **What actually happened instead**: a proper Odoo addon, `installed_base`
  (`odoo18_1/ODOO_STAGING_PT_DIRA/installed_base/`), was written and installed. It implements
  exactly the fields section 6.3/6.4 of the CR describe, with clean names chosen in code instead
  of Studio-assigned ones. See that module's `models/maintenance_equipment.py` and
  `models/product_template.py` for the field definitions themselves — this document only tracks
  where things stand and how to reproduce the install, not a field-by-field spec (the code is the
  spec now).
- **Field name mapping** (CR's original Studio-style name → actual field on the addon):

  | CR §6.3/6.4 name | Actual field (this addon) |
  |---|---|
  | `x_studio_customer` | `customer_id` |
  | `x_parent_equipment_id` | `parent_equipment_id` |
  | `x_product_id` | `catalog_product_id` |
  | `x_lot_id` | `lot_id` |
  | `x_install_date` | `install_date` |
  | `x_status` | `installed_base_status` |
  | `x_runtime_hours` | `runtime_hours` |
  | `x_source_picking_id` | `source_picking_id` (real Many2one to `stock.picking`, not a bare integer) |
  | `x_source_order_id` | `source_order_id` (real Many2one to `sale.order`, not a bare integer) |
  | `x_is_machine` | `is_machine` |

  Fase 2 (master data servis, §6.4) added directly as Python fields with no Studio-era name to map
  from -- the CR's field table already used these exact concepts, this is just their real name:

  | Field | Type | Note |
  |---|---|---|
  | `is_serviceable_part` | Boolean | D-3 gate: enters the registry depth only if true |
  | `service_interval_months` | Integer | primary basis for the due-replacement engine (§9) |
  | `service_interval_hours` | Integer | informational only -- see the field's own help text for why an hours-only part is never projected to a due date |
  | `is_wear_part` | Boolean | |
  | `compatible_category_ids` | Many2many → `maintenance.equipment.category` | family-level match |
  | `compatible_product_ids` | Many2many → **`product.product`** (not `product.template` as the CR's §6.4 table literally says) | model-level match; deviated to variant-level to avoid a template→variant hop against `catalog_product_id`, which is itself variant-level |
  | `superseded_by_id` | Many2one → **`product.product`** (same deviation) | upgrade path, CR benefit #2 |
  | `supersession_note` | Text | |

  `src/integrations/odoo/OdooEquipmentService.js`, `scripts/check-equipment-capability.js` and
  `scripts/backfill-installed-base.js` in the CustPortalCRM repo already use every field above.

## Verification status

Verified live 2026-08-30 with `node scripts/check-equipment-capability.js --connection=<id>`, and
via full backend+frontend round-trips against the real running API (login → session → resolveIdentity
→ Odoo XML-RPC → response), not just schema probes:

| Environment | Result |
|---|---|
| Local dev Odoo (`http://localhost:8099`, db `pt_dira_staging`, run from `odoo18_1/`) | **Fase 1-4 all verified live**, including data-level proof, not just schema: <br>• `check-equipment-capability.js` passes clean (all Fase 1+2 fields, plus a D-3 orphan-component data check). <br>• `backfill-installed-base.js --commit` run twice on real test data (1 machine product + 1 serialized delivery) -- second run correctly skipped the already-registered lot (idempotency, CR §17 acceptance criterion). <br>• `GET /equipment` measured at exactly 3 Odoo XML-RPC calls (werkzeug access log), matching the §15.1 budget. <br>• D-4 proven: a portal user mapped to a *child* contact of the owning partner still sees the parent's unit. <br>• IB-2 proven: an unrelated customer gets an empty list and a 404 on the same unit id (not 403). <br>• D-5 proven: with two units of the same model, `attribution` correctly flips from `unit` to `fleet_estimated` on both. <br>• `due_date`/`days_overdue` math verified against a real backdated `sale.order.line`. <br>• The full draft→confirm cycle for `draft_equipment_correction` (Fase 4) verified against every check in the `asisten-aksi-tulis` skill's checklist: own-draft-only 404, double-confirm 409, expired-draft 410, real ticket created only on confirm -- all against live Odoo, and also codified as `check-assistant-flow.js`'s "kasus 12" (provider+service stubbed, runs in seconds, no Odoo needed to re-verify the orchestration layer). |
| Real staging (`https://odoo.clavisdev.cloud/`, same db name `pt_dira_staging`) | **Installed and verified 2026-08-30.** Initially missing (confirmed to be a *different* physical Postgres database from the local one above, despite matching db name and company "PT DIRA" id 1 -- the local DB is an older dump/copy) -- this gap caused a real production incident (raw Odoo traceback surfaced to a user on `/equipment/due`, see RES-010 in `odoo18_1/ODOO_STAGING_PT_DIRA/docs/resolution.md`). User deployed the module directly to the real server; `check-equipment-capability.js` now passes clean against it (all fields, D-3 check), and `equipmentService.listUnits()` succeeds live for a staging-mapped portal user (empty result -- no equipment data backfilled there yet, which is correct, not an error). |

**Practical consequence**: the entire feature (Fase 1-4) is now proven to work correctly against
**both** the local dev Odoo and the real staging server. What's left before it's useful to an
actual customer on staging is **data, not code or deployment**: `scripts/backfill-installed-base.js`
has never been run there, and no product is flagged `is_machine`/`is_serviceable_part` in the real
data yet (Fase 0's audit -- % of sold units with a serial, model count, etc. -- also still hasn't
been done against real staging data). Also note: the local Odoo app **Helpdesk** had to be
installed (`-i helpdesk`) to make Fase 4's ticket-backed correction flow testable locally -- real
staging already has it (RMA/warranty/tickets already work there).

**A request-time capability guard was added** (`equipmentService.js`'s `withCapabilityGuard`,
2026-08-30) specifically because of the incident above: if this feature is ever pointed at another
Odoo connection where the addon isn't deployed, every endpoint now returns a clean `503
feature_unavailable` instead of leaking a raw Odoo/Python traceback to the client. This does not
replace re-running the capability probe after every deploy -- it's a safety net for connections
nobody thought to check, not a substitute for checking.

**Shared-machine caution**: this local Odoo runs on a machine used concurrently by other work (a
separate `ff_wpc_1` database was seen actively served by another process during this session, with
its own cron jobs and browser traffic). Don't assume a running `odoo-bin` process belongs to this
feature's testing -- check what database it's actually serving (`tail odoo18.log`) before
restarting or killing anything.

## Reproducing the local install (for another dev machine, or after a local DB reset)

```bash
# From odoo18_1/, with the venv activated and Postgres running:
python odoo-18.0+e/odoo-bin -c odoo-18.0+e/odoo.conf -d pt_dira_staging -i installed_base --stop-after-init
```

Then start the server normally (no `-i`, no `--stop-after-init`) to actually serve requests.
`docs/standard.md` §8 in that repo covers when a restart vs `-u <module>` upgrade is needed for
subsequent field changes -- follow it exactly; skipping it produces the
`"model"."field" field is undefined` error documented there.

Re-run `node scripts/check-equipment-capability.js --connection=<id>` after any change to confirm
before trusting the result (IB-5) -- don't assume the addon's field names from this document
without re-checking. Fase 5 (staff console) was deliberately not built -- it's conditional on Q-1
(CR §2.4) being answered "sales in portal," which the client has never actually confirmed; the
default ("sales stays in Odoo") still holds.

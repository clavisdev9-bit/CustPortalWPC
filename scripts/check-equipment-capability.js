// IB-5 (Docs/CR/customer_population_installed_base.md section 4/16): search_read fails its ENTIRE
// call if one requested field is invalid on the model -- this has already broken a listing once in
// this repo (see OdooDeliveryService.js re: carrier_tracking_ref). Nothing in section 6's field
// tables should be trusted, or added to any Odoo*Service's LIST_FIELDS, without running this first
// against the real target.
//
// Also confirms two assumptions the whole feature is built on:
//   - A-2/6.2: maintenance.equipment.partner_id is labeled "Vendor", not the customer -- the
//     reason ownership lives on a separate field instead. If this instance's label ever changes,
//     everything downstream needs re-checking.
//   - A-3: Odoo 17+ uses `quantity` on stock.move.line; <=16 uses `qty_done`. backfill-installed-
//     base.js is written for the 17+ shape (matches the repo's existing OdooDeliveryService/A-3
//     note); this flags it if the target is actually pre-17.
//
// Q-3 (CR section 2.4) resolved "yes" for PT Dira Staging: field names below come from the
// `installed_base` Odoo addon (odoo18_1/ODOO_STAGING_PT_DIRA/installed_base), not Odoo Studio --
// Studio would have forced an `x_studio_` prefix on every field. A DIFFERENT target that only has
// Studio (no addon deploy access) would need these field names changed back to Studio's naming
// (see Docs/ops/odoo_studio_installed_base.md) and re-probed before reuse.
//
// Run: node scripts/check-equipment-capability.js [--connection=<odoo_connections.id>]
// Defaults to the most recently created odoo_connections row. Exits non-zero on any failure.
const pool = require('../src/db/pool');
const odooConnectionRepository = require('../src/repositories/odooConnectionRepository');
const OdooAuthService = require('../src/integrations/odoo/OdooAuthService');
const crypto = require('../src/utils/crypto');

let failed = false;

function ok(message) {
  console.log(`OK   ${message}`);
}

function fail(message) {
  console.error(`FAIL ${message}`);
  failed = true;
}

// Section 6.3/6.4 as implemented by the `installed_base` addon (Fase 1 + Fase 2 fields).
const REQUIRED_FIELDS = {
  'maintenance.equipment': [
    'name', 'serial_no', 'model', 'location', 'category_id', 'company_id', 'effective_date',
    'warranty_date', 'note', 'maintenance_ids', 'partner_id', 'partner_ref',
    'customer_id', 'parent_equipment_id', 'catalog_product_id', 'lot_id', 'install_date',
    'installed_base_status', 'runtime_hours', 'source_picking_id', 'source_order_id',
  ],
  'maintenance.equipment.category': ['id', 'name'],
  'product.template': [
    'is_machine', 'is_serviceable_part', 'service_interval_months', 'service_interval_hours',
    'is_wear_part', 'compatible_category_ids', 'compatible_product_ids', 'superseded_by_id',
    'supersession_note',
  ],
  'stock.move.line': ['state', 'picking_id', 'product_id', 'lot_id', 'date'],
  'maintenance.request': ['id', 'name', 'schedule_date', 'stage_id', 'maintenance_type', 'close_date', 'equipment_id'],
};

function parseArgs(argv) {
  const match = argv.find((arg) => arg.startsWith('--connection='));
  return { connectionId: match ? match.slice('--connection='.length) : null };
}

function fieldsGet(client, uid, credential, model) {
  return client.execute(uid, credential, model, 'fields_get', [], { attributes: ['string', 'type', 'relation'] });
}

async function probeModel(client, uid, credential, model, fields) {
  let schema;
  try {
    schema = await fieldsGet(client, uid, credential, model);
  } catch (err) {
    fail(`${model}: fields_get itself failed -- ${err.message} (is this app installed? A-1)`);
    return null;
  }
  for (const field of fields) {
    if (schema[field]) {
      ok(`${model}.${field} exists (${schema[field].type})`);
    } else {
      fail(`${model}.${field} is missing -- do not add it to LIST_FIELDS until it exists`);
    }
  }
  return schema;
}

async function run() {
  const { connectionId } = parseArgs(process.argv.slice(2));
  const connection = connectionId
    ? await odooConnectionRepository.findById(connectionId)
    : (await odooConnectionRepository.list())[0];

  if (!connection) {
    fail('No row in odoo_connections -- add one via /admin/odoo-connections before probing.');
    return;
  }
  console.log(`Probing "${connection.name}" (${connection.url}, db=${connection.database})\n`);

  const credential = crypto.decrypt(connection.encrypted_credential);
  const client = OdooAuthService.clientFor(connection);

  let uid;
  try {
    uid = await client.authenticate(connection.username, credential);
  } catch (err) {
    fail(`Could not authenticate against Odoo: ${err.message}`);
    return;
  }

  for (const [model, fields] of Object.entries(REQUIRED_FIELDS)) {
    await probeModel(client, uid, credential, model, fields);
  }

  const equipmentSchema = await fieldsGet(client, uid, credential, 'maintenance.equipment').catch(() => null);
  const vendorLabel = equipmentSchema?.partner_id?.string || '';
  if (/vendor/i.test(vendorLabel)) {
    ok(`maintenance.equipment.partner_id is labeled "${vendorLabel}" -- confirmed vendor, not owner (section 6.2)`);
  } else {
    fail(
      `maintenance.equipment.partner_id is labeled "${vendorLabel || '(unknown)'}", not "Vendor" as ` +
        'section 6.2 assumes -- re-verify before relying on customer_id as the only owner field'
    );
  }

  const moveLineSchema = await fieldsGet(client, uid, credential, 'stock.move.line').catch(() => null);
  if (moveLineSchema?.quantity) {
    ok('stock.move.line.quantity exists -- Odoo 17+ shape (A-3); backfill-installed-base.js is correct as written');
  } else if (moveLineSchema?.qty_done) {
    fail('stock.move.line has qty_done but not quantity -- Odoo <=16 shape (A-3); update backfill-installed-base.js before running it');
  } else {
    fail('stock.move.line has neither quantity nor qty_done -- unexpected shape, investigate before backfilling');
  }

  // D-3 (CR section 3): a component has no business being in the registry unless it has its own
  // sellable SKU. This is a data check, not a schema check -- run against whatever L2/L3 rows
  // already exist, so a violation is caught before it's treated as trustworthy registry depth.
  try {
    const orphans = await client.execute(uid, credential, 'maintenance.equipment', 'search_count', [
      [['parent_equipment_id', '!=', false], ['catalog_product_id', '=', false]],
    ]);
    if (orphans === 0) {
      ok('D-3: no child maintenance.equipment row is missing catalog_product_id');
    } else {
      fail(`D-3 VIOLATION: ${orphans} child maintenance.equipment row(s) have no catalog_product_id -- component(s) without a SKU, outside the registry's depth boundary`);
    }
  } catch (err) {
    fail(`Could not run the D-3 orphan-component check: ${err.message}`);
  }
}

run()
  .then(() => {
    if (failed) {
      console.error('\nequipment capability probe FAILED');
      process.exitCode = 1;
    } else {
      console.log('\nequipment capability probe passed');
    }
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

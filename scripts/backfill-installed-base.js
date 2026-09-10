// One-time (then periodic) conversion of historical delivery transactions into L1 registry units
// (maintenance.equipment), per CR Docs/CR/customer_population_installed_base.md section 8.1 --
// this is the highest value-per-effort deliverable in that document: years of past sales become
// a registry with zero manual entry.
//
// Run: node scripts/backfill-installed-base.js [--dry-run|--commit] [--since=YYYY-MM-DD]
//                                               [--connection=<odoo_connections.id>]
// --dry-run is the default. Nothing is written to Odoo unless --commit is passed explicitly.
//
// Idempotent on lot_id: a lot that already has a maintenance.equipment row is skipped, so this
// is safe to re-run (e.g. on a schedule for section 8.2's "incremental" fallback). Exits non-zero
// on failure, per this repo's scripts/*.js convention (no test runner).
//
// A-3 (confirm with scripts/check-equipment-capability.js first): this reads `date` on
// stock.move.line, which exists on every Odoo version -- the quantity vs qty_done split doesn't
// affect this script since quantity/qty_done is never read here, only lot_id/product_id/picking_id.
//
// Field names (lot_id, catalog_product_id, customer_id, install_date, installed_base_status,
// source_picking_id, source_order_id, is_machine) come from the `installed_base` Odoo addon
// (odoo18_1/ODOO_STAGING_PT_DIRA/installed_base) -- Q-3 resolved "addon available" for this
// target, so these are real Python fields, not Odoo Studio's `x_studio_`-prefixed ones.
const pool = require('../src/db/pool');
const odooConnectionRepository = require('../src/repositories/odooConnectionRepository');
const OdooAuthService = require('../src/integrations/odoo/OdooAuthService');
const crypto = require('../src/utils/crypto');

const CREATE_CHUNK_SIZE = 300;

function parseArgs(argv) {
  const args = { commit: false, since: null, connectionId: null };
  for (const arg of argv) {
    if (arg === '--commit') args.commit = true;
    else if (arg === '--dry-run') args.commit = false;
    else if (arg.startsWith('--since=')) args.since = arg.slice('--since='.length);
    else if (arg.startsWith('--connection=')) args.connectionId = arg.slice('--connection='.length);
  }
  return args;
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Mode: ${args.commit ? 'COMMIT (will write to Odoo)' : 'DRY RUN (no writes)'}`);
  if (args.since) console.log(`Since: ${args.since}`);

  const connection = args.connectionId
    ? await odooConnectionRepository.findById(args.connectionId)
    : (await odooConnectionRepository.list())[0];
  if (!connection) throw new Error('No row in odoo_connections -- add one via /admin/odoo-connections first.');
  console.log(`Target: "${connection.name}" (${connection.url}, db=${connection.database})\n`);

  const credential = crypto.decrypt(connection.encrypted_credential);
  const session = await OdooAuthService.openSession(connection, credential);

  // 1. Machines: product.product flagged is_machine on their template (section 6.4).
  const machines = await session.searchRead(
    'product.product',
    [['product_tmpl_id.is_machine', '=', true]],
    ['id', 'name']
  );
  console.log(`Found ${machines.length} product(s) flagged as machines (is_machine).`);
  if (machines.length === 0) {
    console.log('Nothing to backfill -- no product is flagged is_machine yet.');
    return;
  }
  const machineIds = machines.map((m) => m.id);
  const machineNameById = new Map(machines.map((m) => [m.id, m.name]));

  // 2. Every serialized unit that ever shipped OUT to a customer. One batch call, no per-product
  // or per-customer looping (section 15.1/21 anti-pattern).
  const moveLineDomain = [
    ['state', '=', 'done'],
    ['picking_id.picking_type_id.code', '=', 'outgoing'],
    ['product_id', 'in', machineIds],
    ['lot_id', '!=', false],
  ];
  if (args.since) moveLineDomain.push(['date', '>=', args.since]);

  const lines = await session.searchRead('stock.move.line', moveLineDomain, [
    'id', 'product_id', 'lot_id', 'picking_id', 'date',
  ]);
  console.log(`Found ${lines.length} outgoing serialized move line(s) for those products.\n`);
  if (lines.length === 0) {
    console.log('Nothing to backfill -- no matching outgoing serialized deliveries found.');
    return;
  }

  // 3. picking -> partner + company + originating sale order, ONE batch read (section 8.1 point 3),
  // not one call per line.
  const pickingIds = [...new Set(lines.map((l) => l.picking_id[0]))];
  const pickings = await session.read('stock.picking', pickingIds, ['id', 'partner_id', 'company_id', 'date_done', 'sale_id']);
  const pickingById = new Map(pickings.map((p) => [p.id, p]));

  // Archived-partner check (section 8.1 anomaly list) needs `read`, not `search_read` -- search_read
  // applies Odoo's default active-records-only filter and would silently drop archived partners
  // instead of letting this script report them.
  const partnerIds = [...new Set(pickings.map((p) => p.partner_id && p.partner_id[0]).filter(Boolean))];
  const partners = partnerIds.length ? await session.read('res.partner', partnerIds, ['id', 'active']) : [];
  const partnerActiveById = new Map(partners.map((p) => [p.id, p.active]));

  // 4. Idempotency (section 8.1): skip any lot that already has a maintenance.equipment row.
  const candidateLotIds = [...new Set(lines.map((l) => l.lot_id[0]))];
  const existing = await session.searchRead('maintenance.equipment', [['lot_id', 'in', candidateLotIds]], ['id', 'lot_id']);
  const existingLotIds = new Set(existing.map((e) => e.lot_id && e.lot_id[0]).filter(Boolean));

  // 5. Build one create-candidate per lot, keeping the LATEST shipment when a lot appears more than
  // once (section 8.1 anomaly: "lot yang dikembalikan lalu dijual ulang" -- the most recent outgoing
  // move is who actually holds it now). Lines are visited in ascending date order so later entries
  // overwrite earlier ones in the map.
  const sortedLines = [...lines].sort((a, b) => new Date(a.date) - new Date(b.date));
  const anomalies = [];
  const byLot = new Map();
  const duplicateLotCounts = new Map();

  for (const line of sortedLines) {
    const lotId = line.lot_id[0];
    const lotName = line.lot_id[1];
    if (existingLotIds.has(lotId)) continue;

    if (byLot.has(lotId)) {
      duplicateLotCounts.set(lotId, (duplicateLotCounts.get(lotId) || 1) + 1);
    }

    const picking = pickingById.get(line.picking_id[0]);
    if (!picking) {
      anomalies.push({ type: 'missing_picking', lot: lotName, detail: `picking #${line.picking_id[0]} not found` });
      continue;
    }
    if (!picking.partner_id) {
      anomalies.push({ type: 'no_partner', lot: lotName, detail: `picking ${picking.id} has no partner_id` });
      continue;
    }
    if (!picking.company_id) {
      anomalies.push({ type: 'no_company', lot: lotName, detail: `picking ${picking.id} has no company_id` });
      continue;
    }
    if (partnerActiveById.get(picking.partner_id[0]) === false) {
      anomalies.push({ type: 'archived_partner', lot: lotName, detail: `partner "${picking.partner_id[1]}" is archived` });
      continue;
    }

    byLot.set(lotId, {
      name: `${machineNameById.get(line.product_id[0]) || line.product_id[1]} ${lotName}`,
      serial_no: lotName,
      lot_id: lotId,
      catalog_product_id: line.product_id[0],
      customer_id: picking.partner_id[0],
      company_id: picking.company_id[0],
      install_date: (picking.date_done || line.date || '').slice(0, 10) || false,
      installed_base_status: 'active',
      source_picking_id: picking.id,
      source_order_id: picking.sale_id ? picking.sale_id[0] : false,
    });
  }

  for (const [lotId, count] of duplicateLotCounts) {
    anomalies.push({ type: 'duplicate_lot_in_batch', lot: lotId, detail: `appeared in ${count} outgoing move lines -- kept the most recent` });
  }

  const toCreate = [...byLot.values()];

  console.log(`Skipped (already registered): ${existingLotIds.size}`);
  console.log(`Anomalies (not created, needs a human): ${anomalies.length}`);
  for (const a of anomalies.slice(0, 20)) console.log(`  - [${a.type}] lot ${a.lot}: ${a.detail}`);
  if (anomalies.length > 20) console.log(`  ... and ${anomalies.length - 20} more`);
  console.log(`\nTo create: ${toCreate.length}`);
  for (const sample of toCreate.slice(0, 10)) {
    console.log(`  - ${sample.name} (serial ${sample.serial_no}, customer partner #${sample.customer_id})`);
  }
  if (toCreate.length > 10) console.log(`  ... and ${toCreate.length - 10} more`);

  if (!args.commit) {
    console.log('\nDry run only -- re-run with --commit to write these to Odoo.');
    return;
  }
  if (toCreate.length === 0) {
    console.log('\nNothing to commit.');
    return;
  }

  console.log(`\nCommitting ${toCreate.length} equipment record(s)...`);
  let created = 0;
  for (const batch of chunk(toCreate, CREATE_CHUNK_SIZE)) {
    // Odoo's ORM create() accepts a list of value-dicts and returns a list of ids in one round
    // trip (batch create, v12+) -- avoids one XML-RPC call per unit (section 15.1/21).
    const ids = await session.create('maintenance.equipment', batch);
    created += Array.isArray(ids) ? ids.length : 1;
  }
  console.log(`Created ${created} maintenance.equipment record(s).`);
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

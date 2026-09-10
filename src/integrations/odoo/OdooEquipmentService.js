const ApiError = require('../../utils/ApiError');

// CR Docs/CR/customer_population_installed_base.md section 6.2: maintenance.equipment's built-in
// partner_id is labeled "Vendor" -- who the machine was bought FROM, not the customer who owns
// it. Confirmed live 2026-08-30 (scripts/check-equipment-capability.js against PT Dira Staging).
// Reusing it as owner would be silently wrong and could leak equipment across customers with a
// query that still looks correct. The owner lives in a separate field instead, added by the
// `installed_base` Odoo addon (odoo18_1/ODOO_STAGING_PT_DIRA/installed_base) -- Q-3 in the CR
// resolved to "addon deployment is available" for this target, so these are real Python fields
// (models/maintenance_equipment.py), not Odoo Studio fields. Studio would have forced an
// `x_studio_` prefix on every field; a proper addon lets field names match the CR's intent
// exactly. See Docs/ops/odoo_studio_installed_base.md for why that path was superseded.
const CUSTOMER_FIELD = 'customer_id';

// D-4: a unit physically sits at a delivery/site address, which in Odoo is a partner CHILD of the
// commercial entity the portal user is mapped to. An exact partner_id match returns an empty list
// for any customer with more than one shipping address -- partnerIds must be the whole family
// (OdooPartnerService.findFamilyIdsViaSession), computed server-side from the resolved identity,
// never accepted from the request (IB-1).
function baseDomain(partnerIds, companyId) {
  return [
    [CUSTOMER_FIELD, 'in', partnerIds],
    ['company_id', '=', companyId],
  ];
}

// catalog_product_id is the join key to the service catalog master data (section 5 marks it (w)
// required) and is what's exposed as "model" in the API DTO. The built-in "model" char field is
// free text with no id to join on, so it's deliberately not read here -- returning two
// differently-sourced values both called "model" would be ambiguous.
//
// IB-5: search_read fails its ENTIRE call if one field is invalid on the model (already bit this
// repo once, see OdooDeliveryService.js re: carrier_tracking_ref). Every field below is verified
// live against PT Dira Staging (2026-08-30, scripts/check-equipment-capability.js) after
// installing the `installed_base` addon -- re-run that script against any OTHER target before
// pointing this feature at it.
const LIST_FIELDS = [
  'id',
  'name',
  'serial_no',
  'catalog_product_id',
  'category_id',
  'location',
  'install_date',
  'warranty_date',
  'installed_base_status',
  'runtime_hours',
];

// L1 units only (glossary, CR section 2.2): a maintenance.equipment with no parent IS the
// machine; components/parts (L2/L3) are fetched separately via listChildren so a customer with
// many units never pulls the whole component tree into the top-level listing.
function listUnits(session, partnerIds, companyId) {
  return session.searchRead(
    'maintenance.equipment',
    [...baseDomain(partnerIds, companyId), ['parent_equipment_id', '=', false]],
    LIST_FIELDS,
    { order: 'name asc' }
  );
}

// Same rule as every other Odoo-backed service: filter by the family+company lock even on a
// single id (IB-2), so a unit belonging to another customer 404s instead of ever being read.
async function getUnit(session, partnerIds, companyId, equipmentId) {
  const [unit] = await session.searchRead(
    'maintenance.equipment',
    [...baseDomain(partnerIds, companyId), ['id', '=', equipmentId]],
    LIST_FIELDS
  );
  if (!unit) throw new ApiError(404, 'not_found', 'Equipment not found');
  return unit;
}

// Batched on one `parent_equipment_id in [...]` domain -- never called per-unit in a loop
// (section 15.1 anti-pattern: a 200-unit fleet would mean 200+ round trips). Still locked to
// family+company (IB-2) even though the caller already verified the parent id belongs to this
// customer, so this function stays safe to call on its own.
function listChildren(session, partnerIds, companyId, parentIds) {
  if (!parentIds.length) return Promise.resolve([]);
  return session.searchRead(
    'maintenance.equipment',
    [...baseDomain(partnerIds, companyId), ['parent_equipment_id', 'in', parentIds]],
    LIST_FIELDS,
    { order: 'name asc' }
  );
}

// Fase 2 -- service catalog master data (CR section 5/9). A "part" is just a product.template
// flagged is_serviceable_part with these extra attributes; product_variant_id is read (not the
// template id) because everything that needs to match against it -- equipment.catalog_product_id,
// sale.order.line.product_id -- is a product.product id, and matching straight on that avoids a
// variant->template hop on every read. Empty categoryIds/productIds means the caller has no
// active units at all, so there's nothing a part could be compatible with (15.3: empty inputs ->
// empty catalog, not an error).
const CATALOG_FIELDS = [
  'id',
  'product_variant_id',
  'service_interval_months',
  'service_interval_hours',
  'is_wear_part',
  'compatible_category_ids',
  'compatible_product_ids',
  'superseded_by_id',
  'supersession_note',
];

function listServiceCatalog(session, categoryIds, productIds) {
  if (!categoryIds.length && !productIds.length) return Promise.resolve([]);
  const domain = [['is_serviceable_part', '=', true]];
  if (categoryIds.length && productIds.length) {
    domain.push('|', ['compatible_category_ids', 'in', categoryIds], ['compatible_product_ids', 'in', productIds]);
  } else if (categoryIds.length) {
    domain.push(['compatible_category_ids', 'in', categoryIds]);
  } else {
    domain.push(['compatible_product_ids', 'in', productIds]);
  }
  return session.searchRead('product.template', domain, CATALOG_FIELDS);
}

// D-4/D-5: "has this customer bought this part before" has to mean the whole partner family, the
// same reason equipment listing does -- a part bought for a child site still counts. Deliberately
// NOT OdooProductService.getPurchaseHistory: that function is shared with the customer-facing
// "my purchases" page and the assistant's get_purchase_history tool, both of which intentionally
// scope to the exact logged-in partner; widening its domain to a family would silently change
// what those unrelated features show.
//
// Returns `order_id` (not a date) -- sale.order.line has no date field of its own (checked live
// via fields_get: create_date/write_date are the only ones, both system-managed). The caller
// batch-fetches sale.order.date_order via getOrderDates and joins by order_id. create_date was
// tried first and rejected: it's the row's insert timestamp, not the order date, and Odoo's ORM
// silently ignores any create_date passed to create() -- confirmed live, so backdated/imported
// sale orders (or ones simply entered late) would show as "just purchased" and skew every due-date
// calculation that depends on this.
function getPurchaseHistoryForFamily(session, partnerIds, companyId) {
  return session.searchRead(
    'sale.order.line',
    [
      ['order_id.partner_id', 'in', partnerIds],
      ['order_id.company_id', '=', companyId],
      ['order_id.state', 'in', ['sale', 'done']],
    ],
    ['product_id', 'order_id']
  );
}

// Batched, not one read per line -- section 15.1. Keyed by sale.order id so the caller can join
// each purchase line back to when its order was actually placed.
async function getOrderDates(session, orderIds) {
  if (!orderIds.length) return new Map();
  const orders = await session.read('sale.order', orderIds, ['id', 'date_order']);
  return new Map(orders.map((o) => [o.id, o.date_order]));
}

// Fase 3 -- service history per unit (and its children, since a component's own service events
// matter too). maintenance.request already carries equipment_id (OdooMaintenanceService reads the
// same model) -- batched on one `in` domain, not per-unit. Scoped purely by equipmentIds, which
// the caller (getUnit/listChildren) already verified belong to this family -- deliberately NOT
// also ANDing maintenance.request's own x_studio_customer field: that field is populated
// independently of equipment ownership (staff scheduling a request may not always set it), so
// requiring it too would risk silently hiding real service history rather than adding any real
// protection the equipment_id scope doesn't already provide.
function listMaintenanceHistory(session, partnerIds, companyId, equipmentIds) {
  if (!equipmentIds.length) return Promise.resolve([]);
  return session.searchRead(
    'maintenance.request',
    [['equipment_id', 'in', equipmentIds]],
    ['id', 'name', 'schedule_date', 'stage_id', 'maintenance_type', 'close_date', 'equipment_id'],
    { order: 'schedule_date desc' }
  );
}

module.exports = {
  CUSTOMER_FIELD,
  LIST_FIELDS,
  baseDomain,
  listUnits,
  getUnit,
  listChildren,
  listServiceCatalog,
  getPurchaseHistoryForFamily,
  getOrderDates,
  listMaintenanceHistory,
};

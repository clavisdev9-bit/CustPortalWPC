const { resolveOdooContext } = require('./odooContext');
const OdooPartnerService = require('../integrations/odoo/OdooPartnerService');
const OdooEquipmentService = require('../integrations/odoo/OdooEquipmentService');
const OdooHelpdeskService = require('../integrations/odoo/OdooHelpdeskService');
const equipmentCorrectionRepository = require('../repositories/equipmentCorrectionRepository');
const notificationService = require('./notificationService');
const odooCapabilityService = require('./odooCapabilityService');
const ApiError = require('../utils/ApiError');

// D-4 needs both a live session (to read maintenance.equipment) AND the caller's partner family
// (to scope the domain filter) -- resolveOdooContext alone only gives the single mapped partner.
// The family expansion stays local to this service because it is the only feature that needs it;
// odooPartnerId (the single mapped partner, pre-expansion) and connectionId come back too, since
// Fase 4's correction flow needs one partner_id to attribute the helpdesk ticket to and a
// connection id to scope the local equipment_corrections row.
//
// BUG-30/BUG-31: fungsi ini dulu membuka sesinya SENDIRI (resolveIdentity + decrypt +
// OdooAuthService.openSession), yang berarti ia melewati dua penjagaan di odooContext sekaligus
// -- pencatatan kesehatan koneksi dan gerbang kapabilitas. Konsekuensinya nyata: /equipment tetap
// membocorkan pesan kredensial mentah saat koneksi bermasalah, dan menjawab fault XML-RPC mentah
// di Odoo tanpa modul Maintenance. Memakai resolveOdooContext apa adanya mengembalikannya ke
// choke point yang sama dengan seluruh service lain.
async function resolveFamilyContext(userId, currentCompanyId) {
  const ctx = await resolveOdooContext(userId, currentCompanyId, { feature: 'equipment' });
  const partnerIds = await OdooPartnerService.findFamilyIdsViaSession(ctx.session, ctx.odooPartnerId);
  return {
    session: ctx.session,
    partnerIds,
    odooPartnerId: ctx.odooPartnerId,
    odooCompanyId: ctx.odooCompanyId,
    connectionId: ctx.connectionId,
  };
}

// catalog_product_id / category_id come back from Odoo as [id, display_name] tuples -- reshaped
// here so the API/UI never has to know that shape.
function toUnitDto(unit) {
  return {
    id: unit.id,
    name: unit.name,
    serial_number: unit.serial_no || null,
    model: unit.catalog_product_id ? { product_id: unit.catalog_product_id[0], name: unit.catalog_product_id[1] } : null,
    category: unit.category_id ? { id: unit.category_id[0], name: unit.category_id[1] } : null,
    install_date: unit.install_date || null,
    warranty_end: unit.warranty_date || null,
    location: unit.location || null,
    status: unit.installed_base_status || null,
    runtime_hours: unit.runtime_hours ?? null,
  };
}

// -------------------------------------------------------------- Fase 2: mesin rekomendasi (§9) --
// Deterministik, bukan ML -- sama seperti productService.getReorderSuggestions. IB-4: setiap baris
// WAJIB membawa basis + attribution; kode ini tidak boleh punya jalur yang menghasilkan baris tanpa
// keduanya.

const DUE_SOON_DAYS = 60;

function addMonthsUTC(dateStr, months) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

function daysBetween(a, b) {
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

function computeReplacementStatus(dueDate, now) {
  const soonThreshold = new Date(now.getTime() + DUE_SOON_DAYS * 86_400_000);
  if (dueDate < now) return 'overdue';
  if (dueDate < soonThreshold) return 'due_soon';
  return 'ok';
}

function countActiveUnitsByModel(units) {
  const map = new Map();
  for (const u of units) {
    const modelId = u.catalog_product_id && u.catalog_product_id[0];
    if (!modelId) continue;
    map.set(modelId, (map.get(modelId) || 0) + 1);
  }
  return map;
}

// §9.1, applied to `targetUnits` (all active units for the fleet-wide endpoint, or just one for
// the per-unit endpoint) -- `unitCountByModel` is always computed from the WHOLE active fleet
// regardless, so a single-unit call still attributes correctly against siblings it isn't fetching.
// `orderDateById` maps sale.order id -> date_order (OdooEquipmentService.getOrderDates) -- the
// actual date the order was placed, not the row's create_date (see getPurchaseHistoryForFamily's
// own comment for why create_date was rejected: Odoo's ORM won't let it be backdated on create()).
function buildDueReplacementRows(targetUnits, unitCountByModel, catalog, purchaseLines, orderDateById) {
  const now = new Date();

  // Last purchase date per PART VARIANT id, across the whole partner family (D-4/D-5).
  const lastBuyByPart = new Map();
  for (const line of purchaseLines) {
    if (!line.product_id || !line.order_id) continue;
    const orderDate = orderDateById.get(line.order_id[0]);
    if (!orderDate) continue;
    const partId = line.product_id[0];
    const existing = lastBuyByPart.get(partId);
    if (!existing || orderDate > existing) lastBuyByPart.set(partId, orderDate);
  }

  const rows = [];
  for (const unit of targetUnits) {
    // §9.1 step 1: a dead unit generates no lead.
    if (unit.installed_base_status !== 'active') continue;

    const modelId = unit.catalog_product_id && unit.catalog_product_id[0];
    const categoryId = unit.category_id && unit.category_id[0];

    const compatibleParts = catalog.filter((part) => {
      const byCategory = categoryId && (part.compatible_category_ids || []).includes(categoryId);
      const byProduct = modelId && (part.compatible_product_ids || []).includes(modelId);
      return byCategory || byProduct;
    });

    for (const part of compatibleParts) {
      // §9.3: empty interval -> skip silently. Hour-only intervals are skipped too, deliberately
      // -- see service_interval_hours' help text on the Odoo side: nothing here tracks hours
      // consumed since the last replacement, so an hours-based due DATE can't be computed
      // honestly from data this feature actually has (IB-4/R-9: don't show a confident-looking
      // number built on an assumption that isn't true).
      if (!part.service_interval_months) continue;

      const partVariant = part.product_variant_id;
      if (!partVariant) continue; // catalog row with no concrete sellable variant -- can't reference it as a part

      const lastBuy = lastBuyByPart.get(partVariant[0]);
      const basis = lastBuy ? 'last_purchase' : 'install_date';
      const basisDate = lastBuy ? lastBuy.slice(0, 10) : unit.install_date;
      // §9.3: never bought AND no install_date either -> don't show the row (not "overdue").
      if (!basisDate) continue;

      const dueDate = addMonthsUTC(basisDate, part.service_interval_months);
      const status = computeReplacementStatus(dueDate, now);

      const unitsWithModel = modelId ? unitCountByModel.get(modelId) || 0 : 0;
      // D-5: attribution is about whether a PURCHASE can be traced to one unit. When the basis is
      // the unit's own install_date instead (no purchase happened yet), there's no ambiguity to
      // begin with -- that date unambiguously belongs to this one unit regardless of how many
      // siblings share its model, so it's never fleet_estimated.
      const attribution = basis === 'install_date' || unitsWithModel === 1 ? 'unit' : 'fleet_estimated';
      const attributionNote =
        attribution === 'fleet_estimated'
          ? `Pelanggan memiliki ${unitsWithModel} unit model ini; pembelian tidak dapat ditautkan ke unit tertentu.`
          : null;

      rows.push({
        equipment_id: unit.id,
        equipment_name: unit.name,
        part: { product_id: partVariant[0], name: partVariant[1] },
        status,
        due_date: dueDate.toISOString().slice(0, 10),
        days_overdue: status === 'overdue' ? daysBetween(now, dueDate) : null,
        basis,
        basis_date: basisDate,
        attribution,
        attribution_note: attributionNote,
        upgrade: part.superseded_by_id
          ? { product_id: part.superseded_by_id[0], name: part.superseded_by_id[1], note: part.supersession_note || null }
          : null,
      });
    }
  }

  // §9.1 step 5: overdue first, then closest to due.
  const STATUS_ORDER = { overdue: 0, due_soon: 1, ok: 2 };
  rows.sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || new Date(a.due_date) - new Date(b.due_date)
  );
  return rows;
}

// §15.2: this is the most expensive endpoint this feature has -- rate-limited by the controller
// (equipmentRateLimiter.js) before this ever runs.
async function getDueReplacements(userId, currentCompanyId) {
  const { session, partnerIds, odooCompanyId } = await resolveFamilyContext(userId, currentCompanyId);
  const units = await OdooEquipmentService.listUnits(session, partnerIds, odooCompanyId);
  const activeUnits = units.filter((u) => u.installed_base_status === 'active');
  if (activeUnits.length === 0) return [];

  const categoryIds = [...new Set(activeUnits.map((u) => u.category_id && u.category_id[0]).filter(Boolean))];
  const productIds = [...new Set(activeUnits.map((u) => u.catalog_product_id && u.catalog_product_id[0]).filter(Boolean))];
  const catalog = await OdooEquipmentService.listServiceCatalog(session, categoryIds, productIds);
  if (catalog.length === 0) return []; // §15.3: empty catalog -> empty list, not an error

  const purchaseLines = await OdooEquipmentService.getPurchaseHistoryForFamily(session, partnerIds, odooCompanyId);
  const orderDateById = await OdooEquipmentService.getOrderDates(
    session,
    [...new Set(purchaseLines.map((l) => l.order_id && l.order_id[0]).filter(Boolean))]
  );
  return buildDueReplacementRows(activeUnits, countActiveUnitsByModel(activeUnits), catalog, purchaseLines, orderDateById);
}

async function getPartsForUnit(userId, currentCompanyId, equipmentId) {
  const { session, partnerIds, odooCompanyId } = await resolveFamilyContext(userId, currentCompanyId);
  const unit = await OdooEquipmentService.getUnit(session, partnerIds, odooCompanyId, equipmentId); // ensureOwned -> 404
  if (unit.installed_base_status !== 'active') return [];

  // Fetched for accurate D-5 attribution against the WHOLE fleet, not just this one unit -- a
  // customer with 4 units of this model must still see fleet_estimated on this unit's own row.
  const allActiveUnits = (await OdooEquipmentService.listUnits(session, partnerIds, odooCompanyId)).filter(
    (u) => u.installed_base_status === 'active'
  );

  const categoryIds = unit.category_id ? [unit.category_id[0]] : [];
  const productIds = unit.catalog_product_id ? [unit.catalog_product_id[0]] : [];
  const catalog = await OdooEquipmentService.listServiceCatalog(session, categoryIds, productIds);
  if (catalog.length === 0) return [];

  const purchaseLines = await OdooEquipmentService.getPurchaseHistoryForFamily(session, partnerIds, odooCompanyId);
  const orderDateById = await OdooEquipmentService.getOrderDates(
    session,
    [...new Set(purchaseLines.map((l) => l.order_id && l.order_id[0]).filter(Boolean))]
  );
  return buildDueReplacementRows([unit], countActiveUnitsByModel(allActiveUnits), catalog, purchaseLines, orderDateById);
}

// ------------------------------------------------------------------------- Fase 3: riwayat servis --

async function getServiceHistory(userId, currentCompanyId, equipmentId) {
  const { session, partnerIds, odooCompanyId } = await resolveFamilyContext(userId, currentCompanyId);
  const unit = await OdooEquipmentService.getUnit(session, partnerIds, odooCompanyId, equipmentId); // ensureOwned -> 404
  const children = await OdooEquipmentService.listChildren(session, partnerIds, odooCompanyId, [equipmentId]);
  const equipmentIds = [equipmentId, ...children.map((c) => c.id)];

  const requests = await OdooEquipmentService.listMaintenanceHistory(session, partnerIds, odooCompanyId, equipmentIds);
  // Ticket/warranty-claim correlation (mentioned in CR section 10) is deliberately NOT attempted
  // here -- neither helpdesk.ticket nor warranty_claims carries an equipment reference field, and
  // guessing a match (e.g. by scanning free text) risks a false link shown as fact. Only
  // maintenance.request has a real equipment_id to join on.
  return requests.map((r) => ({
    id: r.id,
    name: r.name,
    schedule_date: r.schedule_date || null,
    stage: r.stage_id ? r.stage_id[1] : null,
    maintenance_type: r.maintenance_type || null,
    close_date: r.close_date || null,
    equipment_id: r.equipment_id ? r.equipment_id[0] : null,
    equipment_name: r.equipment_id ? r.equipment_id[1] : null,
  }));
}

async function listUnits(userId, currentCompanyId) {
  const { session, partnerIds, odooCompanyId } = await resolveFamilyContext(userId, currentCompanyId);
  const units = await OdooEquipmentService.listUnits(session, partnerIds, odooCompanyId);
  return units.map(toUnitDto);
}

// L2/L3 component tree (CR Fase 3) isn't backfilled yet, so `components` is simply empty until
// then -- listChildren is already called here so nothing else needs to change once it is.
async function getUnit(userId, currentCompanyId, equipmentId) {
  const { session, partnerIds, odooCompanyId } = await resolveFamilyContext(userId, currentCompanyId);
  const unit = await OdooEquipmentService.getUnit(session, partnerIds, odooCompanyId, equipmentId);
  const children = await OdooEquipmentService.listChildren(session, partnerIds, odooCompanyId, [equipmentId]);
  return { ...toUnitDto(unit), components: children.map(toUnitDto) };
}

// --------------------------------------------------------- Fase 4: permintaan koreksi data --
// Pola stopgap identik rmaService.createRma/warrantyService.createClaim (migrasi 0005): tidak ada
// model Odoo khusus untuk ini, jadi workflow-nya hidup di helpdesk.ticket yang ditautkan. Baris
// portal DB (equipment_corrections) TIDAK menyimpan status -- dibaca live dari tiket setiap kali,
// supaya tidak pernah basi terhadap apa yang staf kerjakan (D-2/IB-3).

function toCorrectionDto(row, ticket) {
  return {
    id: row.id,
    odoo_equipment_id: row.odoo_equipment_id,
    correction_type: row.correction_type,
    proposed_value: row.proposed_value,
    note: row.note,
    created_at: row.created_at,
    ticket_id: row.odoo_ticket_id,
    status: ticket ? ticket.stage_id?.[1] || null : null,
  };
}

async function createCorrection(userId, currentCompanyId, equipmentId, { correctionType, proposedValue, note }) {
  const { session, partnerIds, odooPartnerId, odooCompanyId, connectionId } = await resolveFamilyContext(
    userId,
    currentCompanyId
  );

  // Satu-satunya jalur di service ini yang butuh DUA modul Odoo: resolveFamilyContext sudah
  // memastikan Maintenance ada, tapi permintaan koreksi diwujudkan sebagai helpdesk.ticket.
  // Diperiksa sebelum ensureOwned supaya pesannya menyebut modul yang benar-benar kurang.
  await odooCapabilityService.assertFeature(session, connectionId, 'helpdesk');

  // ensureOwned (IB-2): koreksi hanya boleh diajukan untuk unit yang benar-benar milik keluarga
  // ini -- 404 kalau bukan, bukan diam-diam membuat tiket untuk equipment id sembarangan.
  await OdooEquipmentService.getUnit(session, partnerIds, odooCompanyId, equipmentId);

  const ticket = await OdooHelpdeskService.createTicket(session, odooPartnerId, odooCompanyId, {
    name: `Equipment correction request (#${equipmentId})`,
    description:
      `<p><strong>Correction type:</strong> ${correctionType}</p>` +
      `<p><strong>Proposed value:</strong> ${proposedValue}</p>` +
      (note ? `<p><strong>Note:</strong> ${note}</p>` : ''),
  });

  const row = await equipmentCorrectionRepository.create({
    portalUserId: userId,
    odooConnectionId: connectionId,
    odooEquipmentId: equipmentId,
    odooTicketId: ticket.id,
    correctionType,
    proposedValue,
    note,
  });

  await notificationService
    .notify(userId, {
      type: 'equipment.correction.created',
      title: 'Equipment correction request submitted',
      link: '/equipment',
    })
    .catch((err) => console.error('Failed to record equipment-correction-created notification:', err.message));

  return toCorrectionDto(row, ticket);
}

async function listCorrections(userId, currentCompanyId) {
  const { session, odooPartnerId, odooCompanyId, connectionId } = await resolveFamilyContext(userId, currentCompanyId);
  const rows = await equipmentCorrectionRepository.listForUser(userId, connectionId);
  return Promise.all(
    rows.map(async (row) => {
      const ticket = await OdooHelpdeskService.getTicket(session, odooPartnerId, odooCompanyId, row.odoo_ticket_id).catch(
        () => null
      );
      return toCorrectionDto(row, ticket);
    })
  );
}

// §15.3 NFR / IB-5, enforced at request time (not just by scripts/check-equipment-capability.js,
// which only catches this before a human runs it manually): search_read fails its ENTIRE call
// with a raw Odoo/Python traceback in err.message the moment ONE requested field doesn't exist on
// the target Odoo (see OdooClient.execute -> ApiError(502, 'odoo_call_failed', ...)). That's true
// whether the cause is "the installed_base addon was never deployed to this connection at all" or
// any other capability gap -- same failure shape either way. Left unguarded, that raw traceback
// (Python file paths, line numbers) reaches the API response and ultimately the browser -- both an
// information leak and a "the app is broken" experience for something that's actually a known,
// clean-degradation case the CR's NFR table already specifies ("field Studio belum dibuat -> 503
// feature_unavailable", CR section 15.3). This is the runtime enforcement of that table entry.
const MISSING_FIELD_PATTERN = /Invalid field [\w.]+\.[\w.]+ in leaf/i;

function withCapabilityGuard(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err.code === 'odoo_call_failed' && MISSING_FIELD_PATTERN.test(err.message)) {
        throw new ApiError(
          503,
          'feature_unavailable',
          "Installed base isn't set up on this Odoo connection yet. Contact support."
        );
      }
      throw err;
    }
  };
}

module.exports = {
  listUnits: withCapabilityGuard(listUnits),
  getUnit: withCapabilityGuard(getUnit),
  getDueReplacements: withCapabilityGuard(getDueReplacements),
  getPartsForUnit: withCapabilityGuard(getPartsForUnit),
  getServiceHistory: withCapabilityGuard(getServiceHistory),
  createCorrection: withCapabilityGuard(createCorrection),
  listCorrections: withCapabilityGuard(listCorrections),
};

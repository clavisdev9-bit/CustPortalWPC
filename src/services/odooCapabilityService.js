const ApiError = require('../utils/ApiError');

// BUG-31: portal ini selama ini mengasumsikan setiap Odoo yang terhubung punya SEMUA modul yang
// portalnya dukung. Odoo tidak begitu -- Helpdesk, Maintenance, dan Subscriptions adalah modul
// terpisah yang boleh saja tidak terpasang, dan `installed_base` bahkan addon kustom. Begitu
// salah satunya tidak ada, XML-RPC menjawab dengan fault mentah yang bocor apa adanya ke
// pelanggan ("Object helpdesk.ticket doesn't exist"), dan pada /dashboard satu modul opsional
// yang hilang menjatuhkan seluruh halaman lewat Promise.all.
//
// Dua bentuk kegagalannya berbeda dan keduanya harus dideteksi:
//   - MODEL tidak ada        -> "Object helpdesk.ticket doesn't exist"
//   - FIELD tidak ada        -> "Invalid field sale.order.is_subscription in leaf (...)"
// Yang kedua justru yang lebih licik: `sale.order` ADA, jadi tebakan "cek modelnya saja" lolos
// dan panggilannya tetap gagal. Ini juga peringatan IB-5 di CLAUDE.md -- satu field yang tidak
// valid menggagalkan SELURUH search_read, bukan cuma kolom itu.

// Satu-satunya tempat "fitur portal X butuh apa di Odoo" ditulis. Menambah fitur baru yang
// bersandar pada modul Odoo opsional berarti menambah satu baris di sini -- bukan menyebar
// try/catch di service.
const FEATURES = {
  helpdesk: {
    label: 'Tiket & komplain',
    odooModule: 'Helpdesk',
    models: ['helpdesk.ticket'],
  },
  maintenance: {
    label: 'Jadwal maintenance',
    odooModule: 'Maintenance',
    models: ['maintenance.request'],
  },
  // Butuh modelnya DAN field kepemilikan dari addon `installed_base` -- maintenance.equipment
  // bawaan Odoo tidak punya customer_id, dan tanpa field itu setiap query equipment gagal persis
  // seperti modelnya tidak ada (Docs/CR/customer_population_installed_base.md, IB-5). Ini versi
  // runtime dari scripts/check-equipment-capability.js.
  equipment: {
    label: 'My Equipment / Due Replacements',
    odooModule: 'Maintenance + addon installed_base',
    models: ['maintenance.equipment'],
    fields: { 'maintenance.equipment': ['customer_id'] },
  },
  // Tidak punya model sendiri: Odoo 17+ menjadikan langganan sebagai sale.order dengan
  // is_subscription = true, dan field itulah yang dibawa modul Subscriptions.
  subscriptions: {
    label: 'Kontrak & langganan',
    odooModule: 'Subscriptions',
    fields: { 'sale.order': ['is_subscription'] },
  },
};

// Modul Odoo tidak dipasang-copot setiap menit, tapi seorang admin yang baru memasangnya juga
// tidak boleh menunggu sejam. Cache per koneksi, bukan per user: kapabilitas adalah properti
// Odoo-nya, bukan properti orang yang bertanya.
const TTL_MS = 10 * 60 * 1000;
const cache = new Map();

function invalidate(connectionId) {
  if (connectionId) cache.delete(connectionId);
  else cache.clear();
}

function requiredModels() {
  const models = new Set();
  for (const feature of Object.values(FEATURES)) {
    for (const model of feature.models || []) models.add(model);
    for (const model of Object.keys(feature.fields || {})) models.add(model);
  }
  return [...models];
}

function requiredFieldNames() {
  const names = new Set();
  for (const feature of Object.values(FEATURES)) {
    for (const list of Object.values(feature.fields || {})) for (const name of list) names.add(name);
  }
  return [...names];
}

// Dua panggilan XML-RPC, bukan satu per model: `ir.model` dan `ir.model.fields` adalah registry
// Odoo sendiri, jadi menanyakan seluruh daftar sekaligus jauh lebih murah daripada menebak lewat
// percobaan search_read per model (yang juga akan mengotori log Odoo dengan error palsu).
async function probe(session) {
  const models = await session.searchRead('ir.model', [['model', 'in', requiredModels()]], ['model'], { limit: 500 });
  const presentModels = new Set(models.map((m) => m.model));

  const fields = await session.searchRead(
    'ir.model.fields',
    [['model', 'in', [...presentModels]], ['name', 'in', requiredFieldNames()]],
    ['model', 'name'],
    { limit: 500 }
  );
  const presentFields = new Set(fields.map((f) => `${f.model}.${f.name}`));

  const capabilities = {};
  for (const [name, feature] of Object.entries(FEATURES)) {
    const hasModels = (feature.models || []).every((m) => presentModels.has(m));
    const hasFields = Object.entries(feature.fields || {}).every(([model, list]) =>
      presentModels.has(model) && list.every((f) => presentFields.has(`${model}.${f}`)));
    capabilities[name] = hasModels && hasFields;
  }
  return capabilities;
}

// Gagal terbuka, dengan sengaja: kalau probe-nya sendiri gagal, kembalikan "semua tersedia" dan
// biarkan panggilan sungguhannya yang melaporkan masalahnya. Deteksi kapabilitas tidak boleh
// menjadi titik kegagalan BARU yang mematikan fitur yang sebenarnya sehat. Hasil yang gagal juga
// tidak di-cache, supaya satu gangguan sesaat tidak mengunci jawaban salah selama 10 menit.
async function getCapabilities(session, connectionId) {
  const cached = cache.get(connectionId);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.capabilities;

  let capabilities;
  try {
    capabilities = await probe(session);
  } catch (err) {
    console.error(`[odooCapability] probe gagal untuk koneksi ${connectionId}:`, err.message);
    return Object.fromEntries(Object.keys(FEATURES).map((name) => [name, true]));
  }

  cache.set(connectionId, { at: Date.now(), capabilities });
  return capabilities;
}

async function assertFeature(session, connectionId, featureName) {
  const feature = FEATURES[featureName];
  // Nama fitur yang tidak dikenal adalah salah ketik di kode kita, bukan keadaan Odoo -- jangan
  // diam-diam meloloskannya, karena gerbang yang salah nama berarti tidak ada gerbang sama sekali.
  if (!feature) throw new Error(`Unknown Odoo feature: ${featureName}`);

  const capabilities = await getCapabilities(session, connectionId);
  if (capabilities[featureName]) return;

  throw new ApiError(
    503,
    'feature_unavailable',
    `Fitur "${feature.label}" tidak tersedia: modul ${feature.odooModule} belum terpasang di Odoo `
    + 'yang terhubung ke perusahaan ini. Hubungi administrator portal.'
  );
}

module.exports = { FEATURES, getCapabilities, assertFeature, invalidate };

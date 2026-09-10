const { z } = require('zod');
const assistantConfigRepository = require('../../repositories/assistantConfigRepository');
const ApiError = require('../../utils/ApiError');
const redact = require('./redact');
const permissions = require('./permissions');
const invoiceTools = require('./tools/invoices');
const salesTools = require('./tools/sales');
const productTools = require('./tools/products');
const deliveryTools = require('./tools/deliveries');
const supportTools = require('./tools/support');
const subscriptionTools = require('./tools/subscriptions');
const equipmentTools = require('./tools/equipment');

// I-1: no tool argument schema may accept an identity field -- the LLM must never be able to name
// whose data it wants, only which record and what content. Enforced statically and at load time
// by scripts/check-assistant-invariants.js, which imports FORBIDDEN_ARG_KEYS/findForbiddenArgKeys
// from here so there is one definition, not two that can drift apart.
const FORBIDDEN_ARG_KEYS = [
  'partner_id', 'partnerId', 'customer_id', 'customerId',
  'company_id', 'companyId', 'user_id', 'userId', 'email',
];

const REGISTRY = [
  ...invoiceTools, ...salesTools, ...productTools,
  ...deliveryTools, ...supportTools, ...subscriptionTools, ...equipmentTools,
];

function findForbiddenArgKeys(tool) {
  return Object.keys(tool.args.shape).filter((key) => FORBIDDEN_ARG_KEYS.includes(key));
}

// Walks the zod shape rather than special-casing the empty-object case: most read tools take no
// arguments, but the record-id tools (get_invoice, get_order, ...) do, and Phase 2's draft tools
// will add free-text ones to these same files.
function fieldToJsonSchema(field) {
  let f = field;
  let optional = false;
  while (f instanceof z.ZodOptional || f instanceof z.ZodDefault) {
    optional = true;
    f = f instanceof z.ZodOptional ? f.unwrap() : f._def.innerType;
  }
  let schema;
  if (f instanceof z.ZodEnum) schema = { type: 'string', enum: f.options };
  else if (f instanceof z.ZodNumber) schema = { type: 'number' };
  else if (f instanceof z.ZodBoolean) schema = { type: 'boolean' };
  else schema = { type: 'string' };
  if (f.description) schema.description = f.description;
  return { schema, optional };
}

function zodObjectToJsonSchema(zodObject) {
  const properties = {};
  const required = [];
  for (const [key, field] of Object.entries(zodObject.shape)) {
    const { schema, optional } = fieldToJsonSchema(field);
    properties[key] = schema;
    if (!optional) required.push(key);
  }
  return { type: 'object', properties, required };
}

function describeTool(tool, override) {
  return {
    name: tool.name,
    description: override?.description_override || tool.description,
    jsonSchema: zodObjectToJsonSchema(tool.args),
  };
}

// Baris assistant_tools bersifat OVERRIDE, bukan sumber kebenaran: tool tanpa baris tetap aktif
// dengan permission dari kode. Kalau tabel itu yang jadi sumber kebenaran, menambah tool baru di
// kode akan diam-diam tidak berfungsi sampai seseorang ingat menambahkan barisnya -- kegagalan
// yang tidak menghasilkan pesan error apa pun.
function effectivePermission(tool, override) {
  return override?.permission_code || tool.permission;
}

// Tool yang penggunanya tidak berhak dipakai DIBUANG dari daftar, bukan dikirim lalu ditolak
// (section 7.2 poin 3): model tidak boleh belajar bahwa sebuah tool ada kalau ia tidak bisa
// memakainya, karena ia akan menjanjikannya kepada pengguna.
async function listAvailableTools(ctx) {
  const [granted, overrides] = await Promise.all([
    permissions.getGrantedPermissions(ctx.userId),
    assistantConfigRepository.findToolOverrides(ctx.connectionId || null),
  ]);

  return REGISTRY
    .filter((tool) => {
      const override = overrides.get(tool.name);
      if (override && override.enabled === false) return false;
      return permissions.isGranted(granted, effectivePermission(tool, override));
    })
    .map((tool) => describeTool(tool, overrides.get(tool.name)));
}

// Unfiltered tool descriptions for scripts/eval-assistant.js, which measures model tool-selection
// quality independent of any one user's RBAC grants.
function describeAllTools() {
  return REGISTRY.map((tool) => describeTool(tool, null));
}

// Urutan di sini adalah section 7.2, dan urutannya penting: cek keberadaan dan izin terjadi
// SEBELUM args di-parse, supaya pesan error tidak pernah membocorkan bentuk skema tool yang
// pemanggilnya tidak berhak lihat.
async function dispatch(name, rawArgs, ctx) {
  const tool = REGISTRY.find((t) => t.name === name);
  if (!tool) throw new ApiError(400, 'unknown_tool', `Unknown tool: ${name}`);

  const [granted, overrides] = await Promise.all([
    permissions.getGrantedPermissions(ctx.userId),
    assistantConfigRepository.findToolOverrides(ctx.connectionId || null),
  ]);
  const override = overrides.get(tool.name);

  if (override && override.enabled === false) {
    throw new ApiError(403, 'tool_disabled', `Tool is disabled: ${tool.name}`);
  }
  const permission = effectivePermission(tool, override);
  if (!permissions.isGranted(granted, permission)) {
    throw new ApiError(403, 'forbidden', `Missing permission: ${permission}`);
  }

  // .strict() di setiap skema args (section 7.2 poin 2): key tak dikenal ditolak, bukan
  // diabaikan diam-diam, supaya model yang mulai mengarang argumen gagal dengan berisik.
  const args = tool.args.parse(rawArgs || {});
  const result = await tool.handler(ctx, args);

  // card_ref dihitung dari hasil MENTAH, sebelum redaksi: kartu perlu id record untuk memuat
  // ulang datanya sendiri lewat API portal, dan redact membuang sebagian id itu.
  const cardRef = tool.card ? (tool.cardRef ? tool.cardRef(result, args) : {}) : null;

  // Section 7.2 poin 6: redact dulu, baru summarize. Ringkasan itulah satu-satunya bentuk hasil
  // tool yang pernah masuk konteks model -- hasil mentahnya tidak pernah dikirim.
  const safeResult = redact.apply(tool, result);
  const summary = tool.summarize ? tool.summarize(safeResult) : JSON.stringify(safeResult);

  return { tool, result, summary, card: tool.card || null, cardRef };
}

module.exports = {
  REGISTRY,
  FORBIDDEN_ARG_KEYS,
  findForbiddenArgKeys,
  listAvailableTools,
  describeAllTools,
  dispatch,
};

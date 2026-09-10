// Enforces I-1 and I-2 from Docs/CR/customer_portal_ai_assistant.md section 7.3. Run manually or
// from CI: `node scripts/check-assistant-invariants.js`. Exits non-zero on any violation.
const fs = require('fs');
const path = require('path');

const ASSISTANT_DIR = path.join(__dirname, '..', 'src', 'services', 'assistant');
let failed = false;

function fail(message) {
  console.error(`FAIL: ${message}`);
  failed = true;
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

// I-1: no tool's argument schema may accept an identity field -- the LLM must never be able to
// name whose data it wants.
function checkNoIdentityArgs() {
  const { REGISTRY, findForbiddenArgKeys } = require('../src/services/assistant/toolRegistry');
  if (!REGISTRY.length) {
    fail('toolRegistry.REGISTRY is empty -- nothing to check (is the registry wired up?)');
    return;
  }
  for (const tool of REGISTRY) {
    const forbidden = findForbiddenArgKeys(tool);
    if (forbidden.length) {
      fail(`tool "${tool.name}" accepts forbidden identity argument(s): ${forbidden.join(', ')}`);
    } else {
      console.log(`OK   tool "${tool.name}" has no identity fields in its arg schema`);
    }
  }
}

// I-2: assistant code must only ever call the domain service layer -- never Odoo directly, which
// would bypass the partner_id/company_id lock those services build into every query.
function checkNoDirectOdooAccess() {
  const banned = ['integrations/odoo', 'OdooClient'];
  const files = walk(ASSISTANT_DIR);
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const needle of banned) {
      if (content.includes(needle)) {
        fail(`${path.relative(process.cwd(), file)} references "${needle}" -- assistant code must call the service layer, not Odoo directly`);
      }
    }
  }
  console.log(`OK   scanned ${files.length} file(s) under src/services/assistant/** for direct Odoo access`);
}

checkNoIdentityArgs();
checkNoDirectOdooAccess();

if (failed) {
  console.error('\nassistant invariant check FAILED');
  process.exit(1);
}
console.log('\nassistant invariant check passed');

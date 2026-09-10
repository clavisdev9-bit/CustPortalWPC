// Guards against a Safari compatibility bug recurring in the portal's one global stylesheet.
// WebKit still requires a -webkit- prefixed declaration for a handful of properties (backdrop-
// filter, user-select, ...) that Chrome/Firefox ship unprefixed. There is no PostCSS/autoprefixer
// in this build -- frontend/package.json intentionally has none, and CLAUDE.md requires asking
// before adding a new dependency -- so nothing but an editor extension (which a contributor may
// or may not have installed, and which nothing runs in CI) ever catches a missing prefix.
//
// index.css already had this exact bug fixed once (the .glass-badge rule, blur(4px)) and a second,
// independent instance shipped anyway a few hundred lines later (.topbar, blur(10px)) -- proof the
// fix doesn't stick by memory alone and needs an enforced check. See BUG-39 / CR-055.
//
// Run: `node scripts/check-css-vendor-prefixes.js`. Exits non-zero on any violation.
const fs = require('fs');
const path = require('path');

const STYLE_DIR = path.join(__dirname, '..', 'frontend', 'src');

// Properties WebKit (desktop + iOS Safari) still requires a -webkit- prefix for. Add to this list
// -- don't silently hand-patch around it -- the next time the compat linter (Microsoft Edge Tools
// in VS Code, or caniuse) flags a missing prefix anywhere under frontend/src/**/*.css.
const PREFIXED_PROPERTIES = [
  'backdrop-filter',
  'user-select',
];

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
    else if (entry.name.endsWith('.css')) files.push(full);
  }
  return files;
}

// Splits stylesheet text into leaf declaration blocks (rule bodies containing no nested `{`),
// using a brace-depth stack rather than assuming @media/@container never wrap a rule -- both do,
// throughout this file.
function leafBlocks(content) {
  const withoutComments = content.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [];
  const starts = [];
  for (let i = 0; i < withoutComments.length; i++) {
    const ch = withoutComments[i];
    if (ch === '{') {
      starts.push(i);
    } else if (ch === '}') {
      const openIndex = starts.pop();
      if (openIndex === undefined) continue;
      const body = withoutComments.slice(openIndex + 1, i);
      if (!body.includes('{')) {
        const selectorStart = withoutComments.lastIndexOf('}', openIndex - 1) + 1;
        const selector = withoutComments.slice(selectorStart, openIndex).trim().replace(/\s+/g, ' ');
        blocks.push({ selector, body, offset: openIndex });
      }
    }
  }
  return blocks;
}

function lineOf(content, offset) {
  return content.slice(0, offset).split('\n').length;
}

function checkFile(file, content) {
  for (const block of leafBlocks(content)) {
    for (const prop of PREFIXED_PROPERTIES) {
      const standardRe = new RegExp(`(?<![\\w-])${prop}\\s*:`);
      if (!standardRe.test(block.body)) continue;
      const prefixedRe = new RegExp(`(?<![\\w-])-webkit-${prop}\\s*:`);
      if (!prefixedRe.test(block.body)) {
        const line = lineOf(content, block.offset);
        fail(
          `${path.relative(process.cwd(), file)}:${line} -- rule "${block.selector}" uses `
            + `"${prop}" without a paired "-webkit-${prop}" declaration (Safari requires the prefix)`
        );
      }
    }
  }
}

const files = walk(STYLE_DIR);
if (!files.length) {
  fail(`no .css files found under ${path.relative(process.cwd(), STYLE_DIR)}`);
} else {
  for (const file of files) {
    checkFile(file, fs.readFileSync(file, 'utf8'));
  }
  if (!failed) {
    console.log(
      `OK   scanned ${files.length} file(s), checked ${PREFIXED_PROPERTIES.length} `
        + `WebKit-prefixed propert${PREFIXED_PROPERTIES.length === 1 ? 'y' : 'ies'} in every rule block`
    );
  }
}

if (failed) {
  console.error('\nCSS vendor-prefix check FAILED');
  process.exit(1);
}
console.log('\nCSS vendor-prefix check passed');

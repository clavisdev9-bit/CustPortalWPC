// Companion to stripHtml.js, for the one place we actually want to keep formatting instead of
// flattening it to plain text: an allowlist tree-walk over a DOMParser-parsed, detached document
// -- same reason stripHtml uses DOMParser over regex (decodes entities, never touches the live
// DOM, never executes scripts). Anything not on the allowlist is dropped: an unknown element is
// unwrapped (its children survive, the tag doesn't), an unknown attribute is removed outright.
// This is what SafeHtml.jsx renders via dangerouslySetInnerHTML, so anything that slips through
// here is a live XSS vector -- it must agree with the allowlist in src/utils/sanitizeHtml.js
// (backend), since that's what actually reaches Odoo, but this one is what actually reaches the
// DOM and has to hold on its own against anything Odoo returns, including chatter messages staff
// post directly in Odoo (never sanitized by our own backend).
const ALLOWED_TAGS = new Set(['P', 'BR', 'STRONG', 'EM', 'U', 'S', 'UL', 'OL', 'LI', 'A']);
const ALLOWED_HREF_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

function sanitizeAnchor(el) {
  const rawHref = el.getAttribute('href') || '';
  let safeHref = null;
  try {
    safeHref = new URL(rawHref, window.location.origin);
  } catch {
    safeHref = null;
  }
  Array.from(el.attributes).forEach((attr) => el.removeAttribute(attr.name));
  // No href attribute at all (rather than a javascript:/data: one) is the safe failure mode for a
  // rejected scheme -- the tag survives as inert text-carrying markup instead of disappearing.
  if (safeHref && ALLOWED_HREF_SCHEMES.has(safeHref.protocol)) {
    el.setAttribute('href', safeHref.href);
    el.setAttribute('target', '_blank');
    el.setAttribute('rel', 'noopener noreferrer');
  }
}

function sanitizeChildren(parent) {
  // Array.from snapshots the live NodeList once -- replaceWith/removeAttribute below mutate
  // childNodes/attributes as we go, and iterating a live collection while mutating it skips nodes.
  Array.from(parent.childNodes).forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) return;
    if (node.nodeType !== Node.ELEMENT_NODE) {
      node.remove();
      return;
    }
    sanitizeChildren(node);
    if (!ALLOWED_TAGS.has(node.tagName)) {
      node.replaceWith(...node.childNodes);
      return;
    }
    if (node.tagName === 'A') {
      sanitizeAnchor(node);
    } else {
      Array.from(node.attributes).forEach((attr) => node.removeAttribute(attr.name));
    }
  });
}

export function sanitizeHtml(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // Dropped outright rather than left for the allowlist unwrap below -- unwrapping a <script>
  // would leak its text content (the script body) into the page as visible text.
  doc.querySelectorAll('script, style').forEach((el) => el.remove());
  sanitizeChildren(doc.body);
  return doc.body.innerHTML;
}

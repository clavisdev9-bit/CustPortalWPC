const sanitizeHtml = require('sanitize-html');

// Mirrors the allowlist in frontend/src/utils/sanitizeHtml.js -- the two must agree, since a value
// written here is later read back and rendered client-side through that same allowlist in
// SafeHtml.jsx. This is the last stop before Odoo (called from OdooHelpdeskService, the one place
// every write path -- ticket create/reply, RMA, warranty -- actually calls session.create/
// message_post): never trust a value here just because a Zod validator already checked its
// length/type upstream, since Zod only bounds shape, not markup.
const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'u', 's', 'ul', 'ol', 'li', 'a'];

function sanitizeRichText(html) {
  if (!html) return '';
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { a: ['href', 'target', 'rel'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    // Forces target/rel on every surviving link regardless of what the client sent, rather than
    // trusting target/rel values from the request body -- reverse-tabnabbing protection shouldn't
    // depend on the client having set it correctly.
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }, true),
    },
  });
}

module.exports = { sanitizeRichText };

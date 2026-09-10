// mail.message bodies and Html-typed fields (e.g. helpdesk.ticket.description) come back as HTML
// from Odoo. Rather than trust that HTML and render it (dangerouslySetInnerHTML), strip tags down
// to plain text -- shown as-is via JSX text nodes, which React escapes, so this can never
// introduce an XSS vector. Shared by every panel that renders an Odoo HTML field (BUG-19: this
// used to be copy-pasted per panel, and one copy went unpatched).
//
// Parsed via DOMParser into a detached document rather than a regex tag-strip: it decodes
// entities (&nbsp; etc.) the same pass it drops tags, and never executes scripts or touches the
// live DOM since only .textContent is read back.
export function stripHtml(html) {
  if (!html) return '';
  const text = new DOMParser().parseFromString(html, 'text/html').body.textContent || '';
  return text.replace(/\s+/g, ' ').trim();
}

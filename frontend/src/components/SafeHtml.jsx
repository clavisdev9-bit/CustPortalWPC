import { sanitizeHtml } from '../utils/sanitizeHtml';

// The only place in the app that uses dangerouslySetInnerHTML. Safe because sanitizeHtml runs an
// allowlist tree-walk immediately before render -- it strips anything not on that allowlist
// (scripts, event-handler attributes, javascript: hrefs, arbitrary tags), regardless of whether
// the HTML came from this app's own rich text editor or from a chatter message staff posted
// directly in Odoo.
export default function SafeHtml({ html, className }) {
  if (!html) return null;
  return (
    <div
      className={className ? `rich-text ${className}` : 'rich-text'}
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
    />
  );
}

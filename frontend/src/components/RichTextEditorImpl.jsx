import { useState } from 'react';
import { Editor } from '@tinymce/tinymce-react';
import 'tinymce/tinymce';
import 'tinymce/icons/default';
import 'tinymce/themes/silver';
import 'tinymce/models/dom';
import 'tinymce/plugins/lists';
import 'tinymce/plugins/link';
import 'tinymce/plugins/autolink';
import contentCss from 'tinymce/skins/content/default/content.css?inline';
import contentCssDark from 'tinymce/skins/content/dark/content.css?inline';

// TinyMCE renders its toolbar chrome in the main document but the editable area in an iframe, so
// the app's --color-* custom properties can't reach either one the way the rest of the UI does.
// Self-hosted (no tinymceScriptSrc, no cloud key) also means TinyMCE has no base URL to fetch its
// own skin/content CSS from at runtime, so both are imported directly here instead: skin.css as a
// real stylesheet for the toolbar chrome (picked once below, since oxide and oxide-dark are two
// full alternative skins, not a base + override), and content css inlined via `?inline` and handed
// to TinyMCE as content_style so it's written straight into the iframe's <style> tag.
function resolveDarkMode() {
  const stored = localStorage.getItem('portal-theme');
  if (stored === 'dark') return true;
  if (stored === 'light') return false;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

const prefersDark = resolveDarkMode();
if (prefersDark) {
  import('tinymce/skins/ui/oxide-dark/skin.css');
} else {
  import('tinymce/skins/ui/oxide/skin.css');
}

// Kept in sync with the allowlist in src/utils/sanitizeHtml.js (backend) and
// frontend/src/utils/sanitizeHtml.js (render side) -- no image/table/media plugin, since neither
// sanitizer lets those tags through, and photo upload on drafts isn't in Fase 2 scope anyway.
const TOOLBAR = 'bold italic underline | bullist numlist | link | removeformat';
const PLUGINS = 'lists link autolink';

export default function RichTextEditorImpl({ value, onChange, disabled }) {
  // Read once on mount, not on every render -- TinyMCE can't re-skin a mounted editor via a prop
  // change, so this deliberately won't follow ThemeToggle if it's flipped while the editor is open.
  const [dark] = useState(prefersDark);

  return (
    <div className="rich-text-editor">
      <Editor
        licenseKey="gpl"
        disabled={disabled}
        value={value ?? ''}
        onEditorChange={onChange}
        init={{
          menubar: false,
          statusbar: false,
          branding: false,
          promotion: false,
          toolbar: TOOLBAR,
          plugins: PLUGINS,
          skin: false,
          content_css: false,
          content_style: dark ? contentCssDark : contentCss,
          height: 220,
          link_default_target: '_blank',
          rel_list: [{ title: 'noopener noreferrer', value: 'noopener noreferrer' }],
        }}
      />
    </div>
  );
}

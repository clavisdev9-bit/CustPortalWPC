import { lazy, Suspense } from 'react';

// TinyMCE (icons/theme/plugins/skins) is heavy enough on its own to noticeably grow the app's
// single main bundle if imported eagerly here -- every page would pay for it on load, not just
// the handful of compose forms that actually use it. lazy() gives it its own chunk, fetched only
// once a RichTextEditor actually mounts; the plain textarea fallback below is what's visible for
// that one network round trip, not a design meant to double as a no-JS degradation path.
const RichTextEditorImpl = lazy(() => import('./RichTextEditorImpl'));

export default function RichTextEditor(props) {
  return (
    <Suspense fallback={<textarea className="rich-text-editor__loading" rows={6} disabled value="" readOnly />}>
      <RichTextEditorImpl {...props} />
    </Suspense>
  );
}

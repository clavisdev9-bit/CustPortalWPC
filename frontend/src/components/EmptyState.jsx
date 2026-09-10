// Friendly placeholder for "there's nothing here yet" states, replacing the bare
// <p className="muted">No ... yet.</p> lines. Pass a short title and an optional hint.
const DEFAULT_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 8l2-4h14l2 4" />
    <path d="M3 8v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8z" />
    <path d="M3 12h5l1.5 2.5h5L16 12h5" />
  </svg>
);

export default function EmptyState({ title, hint, icon, action }) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon">{icon || DEFAULT_ICON}</span>
      <p className="empty-state__title">{title}</p>
      {hint && <p className="empty-state__hint">{hint}</p>}
      {action}
    </div>
  );
}

// Formats the mock dataset's date/datetime strings ("2026-08-14", "2026-08-14 22:40",
// "Est. 2026-09-18", "—") into a readable form, preserving the "Est." prefix for projected dates.
export function formatShipmentDate(value) {
  if (!value || value === '—') return '—';
  const isEstimate = value.startsWith('Est.');
  const clean = isEstimate ? value.replace('Est. ', '') : value;
  const hasTime = clean.includes(':');
  const iso = clean.includes(' ') ? clean.replace(' ', 'T') : `${clean}T00:00:00`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return value;
  const opts = hasTime
    ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', year: 'numeric' };
  const out = date.toLocaleDateString('en-US', opts);
  return isEstimate ? `Est. ${out}` : out;
}

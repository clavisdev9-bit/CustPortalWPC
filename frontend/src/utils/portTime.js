// Vessel schedule times are always quoted in the local time of the relevant PORT, never in the
// viewer's own timezone (CR D-4, Docs/CR/customer_portal_vessel_schedule.md) -- a Jakarta customer
// reading a Singapore ETD as if it were WIB is exactly the kind of error that isn't visible on a
// developer's screen and only surfaces at the dock. `Intl.DateTimeFormat` with an explicit
// `timeZone` does the conversion with zero new dependencies.
//
// Every formatted value is labeled: `LT` (local time) when the port's timezone is known, `UTC`
// when it isn't (CR §15.3 degradation rule) -- never silently treated as local.
export function formatPortTime(iso, tz) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const opts = {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  };
  if (tz) {
    return `${new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: tz }).format(date)} LT`;
  }
  return `${new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }).format(date)} UTC`;
}

// For `updated_at` -- a plain timestamp, not tied to any port, so it's formatted in the viewer's
// own local time rather than converted anywhere.
export function formatUpdatedAt(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

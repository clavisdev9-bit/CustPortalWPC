// A single place that turns the many status strings coming from Odoo (order state,
// invoice payment_state, delivery portal_status, subscription state, user status,
// request status, ...) into a colored pill. Keyword-based so it degrades gracefully:
// anything unrecognized renders as a neutral pill rather than breaking.
const RULES = [
  [/(cancel|reject|decline|overdue|fail|disabl|block|error|revers|expired|void|refus)/i, 'danger'],
  [/(paid|done|sale|deliver|active|approv|confirm|complet|close|resolv|fulfil|success)/i, 'success'],
  [/(pending|partial|wait|hold|due|process|invite|not.?paid|unpaid|to.?invoice|review|request|await)/i, 'warning'],
  [/(sent|transit|ship|assign|progress|open|new)/i, 'info'],
];

function toneFor(status) {
  const value = String(status).toLowerCase();
  for (const [pattern, tone] of RULES) {
    if (pattern.test(value)) return tone;
  }
  return 'neutral';
}

function labelFor(status) {
  return String(status).replace(/[_-]+/g, ' ').trim();
}

export default function StatusBadge({ status }) {
  if (status === null || status === undefined || status === '') {
    return <span className="muted">—</span>;
  }
  return <span className={`pill pill--${toneFor(status)}`}>{labelFor(status)}</span>;
}

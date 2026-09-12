import { STATE_LABEL, STATE_TONE } from '../data/vesselScheduleMockData';

// Domain-specific status pill for Vessel Schedule (D-5 states), mirrors ShipmentStatusBadge: the
// generic StatusBadge's keyword regex would classify "Cancelled" as danger and miss "Delayed"
// entirely, which inverts this feature's tone mapping (see STATE_TONE).
export default function VesselStatusBadge({ state }) {
  const tone = STATE_TONE[state] || 'neutral';
  return <span className={`pill pill--${tone}`}>{STATE_LABEL[state] || state}</span>;
}

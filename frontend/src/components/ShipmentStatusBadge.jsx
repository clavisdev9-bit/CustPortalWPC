import { STATUS_TONE } from '../data/shipmentMockData';

// Domain-specific status pill for Shipment Tracking. Not the generic StatusBadge: its regex
// classifies "Cancelled" as danger and "Delayed"/"Arriving Soon" as neutral, which inverts what
// this feature's spec calls for (blue/green/orange/red/gray -- see shipmentMockData.STATUS_TONE).
export default function ShipmentStatusBadge({ status }) {
  const tone = STATUS_TONE[status] || 'neutral';
  return <span className={`pill pill--${tone}`}>{status}</span>;
}

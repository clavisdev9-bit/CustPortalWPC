import {
  BOOKING_STATE_LABEL, BOOKING_STATE_TONE, FLIGHT_STATE_LABEL, FLIGHT_STATE_TONE,
} from '../data/airScheduleMockData';

// Domain-specific status pills for Air Cargo Schedule, mirrors VesselStatusBadge: flight state
// (D-8) and booking state (Q-5) use different vocabularies, so the generic keyword-based
// StatusBadge would misclassify both.
export function FlightStatusBadge({ state }) {
  const tone = FLIGHT_STATE_TONE[state] || 'neutral';
  return <span className={`pill pill--${tone}`}>{FLIGHT_STATE_LABEL[state] || state}</span>;
}

export function BookingStatusBadge({ state }) {
  const tone = BOOKING_STATE_TONE[state] || 'neutral';
  return <span className={`pill pill--${tone}`}>{BOOKING_STATE_LABEL[state] || state}</span>;
}

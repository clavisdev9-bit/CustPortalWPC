import EmptyState from './EmptyState';
import { FlightStatusBadge } from './AirScheduleStatusBadge';
import { formatPortTime } from '../utils/portTime';

// Capacity is two independent gauges (kg / cbm), not one combined bar (D-6) -- a booking can be
// light-but-bulky or heavy-but-small, and collapsing both into one number hides whichever one is
// actually the constraint.
export function CapacityGauge({ label, used, capacity, unit }) {
  const pct = capacity > 0 ? Math.min(100, (used / capacity) * 100) : 0;
  const over = used > capacity;
  return (
    <div className="air-schedule-gauge">
      <div className="air-schedule-gauge__head">
        <span>{label}</span>
        <span className={`mono${over ? ' air-schedule-gauge__value--over' : ''}`}>
          {used.toLocaleString()} / {capacity.toLocaleString()} {unit}
        </span>
      </div>
      <div className="air-schedule-gauge__track">
        <div
          className={`air-schedule-gauge__fill${over ? ' air-schedule-gauge__fill--over' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// Follows the list+gauge pattern from ShipmentTrackingPage.jsx (CR §2.3), but as clickable cards
// rather than a table -- closer to the approved "Cargo Ops Console" mockup, and it leaves room for
// the two capacity gauges per row that a table cell wouldn't comfortably fit.
export default function AirScheduleFlightBoard({ flights, selectedId, onSelect }) {
  if (flights.length === 0) {
    return (
      <EmptyState
        title="No flights match your filters"
        hint="Try widening the date range or clearing the search/status filters."
      />
    );
  }

  return (
    <div className="air-schedule-board">
      {flights.map((f) => (
        <button
          type="button"
          key={f.id}
          className={`air-schedule-flight-card${f.id === selectedId ? ' is-selected' : ''}`}
          onClick={() => onSelect(f.id)}
        >
          <div className="air-schedule-flight-card__head">
            <span className="air-schedule-flight-card__no">{f.flight_no}</span>
            <FlightStatusBadge state={f.state} />
          </div>
          <div className="muted">{f.airline.name} · {f.aircraft_type}</div>
          <div className="air-schedule-flight-card__route mono">
            {f.origin.iata_code} → {f.dest.iata_code}
          </div>
          <div className="muted" style={{ fontSize: '0.8rem' }}>
            ETD {formatPortTime(f.etd, f.origin.tz)}
            {f.atd && <> · ATD {formatPortTime(f.atd, f.origin.tz)}</>}
          </div>
          <CapacityGauge label="Weight" used={f.used_kg} capacity={f.capacity_kg} unit="kg" />
          <CapacityGauge label="Volume" used={f.used_cbm} capacity={f.capacity_cbm} unit="cbm" />
          <div className="muted" style={{ fontSize: '0.8rem' }}>{f.booking_count} booking(s) assigned</div>
        </button>
      ))}
    </div>
  );
}

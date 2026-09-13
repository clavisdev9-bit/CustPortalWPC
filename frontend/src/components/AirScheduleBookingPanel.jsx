import EmptyState from './EmptyState';
import { BookingStatusBadge, FlightStatusBadge } from './AirScheduleStatusBadge';
import { CapacityGauge } from './AirScheduleFlightBoard';
import { formatUpdatedAt } from '../utils/portTime';

// Detail panel for the flight selected on the board (left), split in two: bookings already
// assigned to this flight, and the unassigned pool available to assign into it.
//
// D-3/AS-3 (do not "fix" this): the assigned list below routinely mixes bookings from several
// different customers on one flight, and the pool below is every unassigned booking in the
// company -- not filtered to any one customer. That is the point of this staff console.
export default function AirScheduleBookingPanel({ flight, assignedBookings, unassignedBookings, onAssign, onUnassign, onNewBooking }) {
  if (!flight) {
    return (
      <div className="card">
        <EmptyState
          title="Select a flight from the board"
          hint="Its assigned bookings and the unassigned pool will show up here."
        />
      </div>
    );
  }

  const routeMatches = unassignedBookings.filter(
    (b) => b.origin_airport_id === flight.origin_airport_id && b.dest_airport_id === flight.dest_airport_id,
  );
  const otherPool = unassignedBookings.filter((b) => !routeMatches.includes(b));

  return (
    <div className="air-schedule-panel">
      <div className="card">
        <div className="air-schedule-panel__head">
          <div>
            <h2 style={{ margin: 0 }}>{flight.flight_no}</h2>
            <span className="muted">{flight.airline.name} · {flight.origin.iata_code} → {flight.dest.iata_code}</span>
          </div>
          <FlightStatusBadge state={flight.state} />
        </div>
        <p className="muted" style={{ fontSize: '0.8rem' }}>Last updated {formatUpdatedAt(flight.updated_at)}</p>

        <CapacityGauge label="Weight" used={flight.used_kg} capacity={flight.capacity_kg} unit="kg" />
        <CapacityGauge label="Volume" used={flight.used_cbm} capacity={flight.capacity_cbm} unit="cbm" />
        <p className="muted" style={{ fontSize: '0.78rem' }}>
          Based on actual weight only — volumetric (chargeable) weight is not calculated in this preview (D-6).
        </p>

        <div className="air-schedule-panel__section-head">
          <h3>Assigned bookings ({assignedBookings.length})</h3>
        </div>
        {assignedBookings.length === 0 ? (
          <p className="muted">No bookings assigned to this flight yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>AWB</th>
                  <th>Customer</th>
                  <th>Commodity</th>
                  <th>Weight</th>
                  <th>Volume</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {assignedBookings.map((b) => (
                  <tr key={b.id}>
                    <td className="mono">{b.awb_number}</td>
                    <td>{b.customer.name}</td>
                    <td>{b.commodity}</td>
                    <td className="mono">{b.weight_kg.toLocaleString()} kg</td>
                    <td className="mono">{b.volume_cbm.toLocaleString()} cbm</td>
                    <td><BookingStatusBadge state={b.state} /></td>
                    <td>
                      {b.state === 'assigned' && (
                        <button type="button" className="btn-secondary" onClick={() => onUnassign(b.id)}>Remove</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="air-schedule-panel__section-head">
          <h3>Unassigned pool</h3>
          <button type="button" className="btn-primary" onClick={onNewBooking}>+ New Booking</button>
        </div>
        {unassignedBookings.length === 0 ? (
          <p className="muted">Nothing waiting to be assigned right now.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>AWB</th>
                  <th>Customer</th>
                  <th>Route</th>
                  <th>Commodity</th>
                  <th>Weight</th>
                  <th>Volume</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {[...routeMatches, ...otherPool].map((b) => (
                  <tr key={b.id} className={routeMatches.includes(b) ? 'air-schedule-pool-row--match' : undefined}>
                    <td className="mono">{b.awb_number}</td>
                    <td>{b.customer.name}</td>
                    <td className="mono">{b.origin.iata_code} → {b.dest.iata_code}</td>
                    <td>{b.commodity}</td>
                    <td className="mono">{b.weight_kg.toLocaleString()} kg</td>
                    <td className="mono">{b.volume_cbm.toLocaleString()} cbm</td>
                    <td>
                      <button type="button" className="btn-primary" onClick={() => onAssign(b.id)}>Assign</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

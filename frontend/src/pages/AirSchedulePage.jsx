import { useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import ToastStack, { useToasts } from '../components/Toast';
import AirScheduleFlightBoard from '../components/AirScheduleFlightBoard';
import AirScheduleBookingPanel from '../components/AirScheduleBookingPanel';
import {
  AIRLINES, AIRPORTS, CUSTOMERS, COMMODITIES,
  FLIGHTS, BOOKINGS, FLIGHT_STATES, FLIGHT_STATE_LABEL,
  createMockBooking,
} from '../data/airScheduleMockData';

// Docs/CR/air_schedule.md, Fase 0 (blocking): clickable prototype over an in-memory mock -- the
// `freight_schedule` addon extension this would read/write from Odoo (freight.flight/airline/
// airport/cargo.booking, CR §6) doesn't exist yet, so there is no `src/api/airSchedule.js` module
// and nothing on this page is sent anywhere.
//
// D-4/AS-7: this is a STAFF console, not a customer one. The nav entry only renders for
// 'Staff (Internal)'/platform admin (AppShell.jsx), and this page re-checks the same condition
// itself (same pattern as AssistantAdminPage.jsx's is_platform_admin check) so a direct link
// doesn't show a working console to the wrong role even in this frontend-only preview. The real
// gate, once Fase 1 exists, is `requirePermission('air_schedule.view'|'air_schedule.manage')` on
// the backend (CR §11) -- this check is cosmetic, per CLAUDE.md rule #3.
//
// D-3/AS-3: bookings below are NOT filtered to "the logged-in customer's own" anything -- staff
// assign booking from ANY customer on the board to ANY flight. Don't add a customer/partner filter
// here; that would defeat the entire point of this console.

function usedCapacity(flightId, bookings, excludeBookingId) {
  return bookings.reduce((acc, b) => {
    if (b.flight_id !== flightId || b.id === excludeBookingId || b.state === 'cancelled') return acc;
    return { kg: acc.kg + b.weight_kg, cbm: acc.cbm + b.volume_cbm, count: acc.count + 1 };
  }, { kg: 0, cbm: 0, count: 0 });
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-3.5-3.5" />
    </svg>
  );
}

function emptyBookingForm() {
  return {
    customerPartnerId: '', originAirportId: '', destAirportId: '',
    weightKg: '', volumeCbm: '', commodity: COMMODITIES[0], notes: '',
  };
}

export default function AirSchedulePage() {
  const { user } = useAuth();
  const { toasts, push, dismiss } = useToasts();

  const [bookings, setBookings] = useState(BOOKINGS);
  const [selectedFlightId, setSelectedFlightId] = useState(FLIGHTS[0]?.id ?? null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [airlineFilter, setAirlineFilter] = useState('');
  const [originFilter, setOriginFilter] = useState('');
  const [destFilter, setDestFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [newBookingOpen, setNewBookingOpen] = useState(false);
  const [form, setForm] = useState(emptyBookingForm);

  const isStaff = !!user?.is_platform_admin
    || (Array.isArray(user?.roles) && user.roles.includes('Staff (Internal)'));

  // Aggregation done in one pass over ALL bookings for the whole board, not one lookup per flight
  // row (CR §12.1 budget rule -- the real backend does this with one `search_read`, this mock just
  // mirrors the shape so the future swap is a data-source change, not a re-render change).
  const enrichedFlights = useMemo(() => FLIGHTS.map((f) => {
    const used = usedCapacity(f.id, bookings);
    return { ...f, used_kg: used.kg, used_cbm: used.cbm, booking_count: used.count };
  }), [bookings]);

  const counts = useMemo(() => {
    const c = {};
    for (const s of FLIGHT_STATES) c[s] = enrichedFlights.filter((f) => f.state === s).length;
    return c;
  }, [enrichedFlights]);

  const filteredFlights = useMemo(() => {
    let rows = enrichedFlights;
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((f) => f.flight_no.toLowerCase().includes(q)
        || f.airline.name.toLowerCase().includes(q)
        || f.origin.iata_code.toLowerCase().includes(q)
        || f.dest.iata_code.toLowerCase().includes(q));
    }
    if (statusFilter) rows = rows.filter((f) => f.state === statusFilter);
    if (airlineFilter) rows = rows.filter((f) => f.airline_id === Number(airlineFilter));
    if (originFilter) rows = rows.filter((f) => f.origin_airport_id === Number(originFilter));
    if (destFilter) rows = rows.filter((f) => f.dest_airport_id === Number(destFilter));
    if (dateFrom) rows = rows.filter((f) => f.etd.slice(0, 10) >= dateFrom);
    if (dateTo) rows = rows.filter((f) => f.etd.slice(0, 10) <= dateTo);
    return [...rows].sort((a, b) => a.etd.localeCompare(b.etd));
  }, [enrichedFlights, search, statusFilter, airlineFilter, originFilter, destFilter, dateFrom, dateTo]);

  const selectedFlight = enrichedFlights.find((f) => f.id === selectedFlightId) || null;
  const assignedBookings = selectedFlightId
    ? bookings.filter((b) => b.flight_id === selectedFlightId)
    : [];
  const unassignedBookings = bookings.filter((b) => b.flight_id == null && b.state === 'unassigned');

  if (!isStaff) {
    return <div className="card"><p>This page is for internal staff only.</p></div>;
  }

  function clearFilters() {
    setSearch(''); setStatusFilter(''); setAirlineFilter('');
    setOriginFilter(''); setDestFilter(''); setDateFrom(''); setDateTo('');
  }

  // Mirrors AS-6: capacity is re-checked here (against the current in-memory total) before the
  // "write" happens, never trusted from whatever the gauge already showed on screen.
  function handleAssign(bookingId) {
    if (!selectedFlight) return;
    const booking = bookings.find((b) => b.id === bookingId);
    if (!booking) return;
    const used = usedCapacity(selectedFlight.id, bookings, bookingId);
    const newKg = used.kg + booking.weight_kg;
    const newCbm = used.cbm + booking.volume_cbm;
    if (newKg > selectedFlight.capacity_kg || newCbm > selectedFlight.capacity_cbm) {
      push({
        tone: 'error',
        title: 'Capacity exceeded',
        description: `${selectedFlight.flight_no} has ${(selectedFlight.capacity_kg - used.kg).toLocaleString()} kg `
          + `/ ${(selectedFlight.capacity_cbm - used.cbm).toLocaleString()} cbm left — this booking needs `
          + `${booking.weight_kg.toLocaleString()} kg / ${booking.volume_cbm.toLocaleString()} cbm.`,
      });
      return;
    }
    setBookings((prev) => prev.map((b) => (b.id === bookingId
      ? { ...b, flight_id: selectedFlight.id, state: 'assigned', updated_at: new Date().toISOString() }
      : b)));
    push({ tone: 'success', title: 'Booking assigned', description: `${booking.awb_number} assigned to ${selectedFlight.flight_no}.` });
  }

  function handleUnassign(bookingId) {
    const booking = bookings.find((b) => b.id === bookingId);
    if (!booking) return;
    setBookings((prev) => prev.map((b) => (b.id === bookingId
      ? { ...b, flight_id: null, state: 'unassigned', updated_at: new Date().toISOString() }
      : b)));
    push({ tone: 'info', title: 'Booking removed', description: `${booking.awb_number} returned to the unassigned pool.` });
  }

  function handleCreateBooking(e) {
    e.preventDefault();
    if (!form.customerPartnerId || !form.originAirportId || !form.destAirportId) {
      push({ tone: 'error', title: 'Missing fields', description: 'Pick a customer, origin, and destination.' });
      return;
    }
    if (form.originAirportId === form.destAirportId) {
      push({ tone: 'error', title: 'Invalid route', description: 'Origin and destination must be different airports.' });
      return;
    }
    const weightKg = Number(form.weightKg);
    const volumeCbm = Number(form.volumeCbm);
    if (!(weightKg > 0) || !(volumeCbm > 0)) {
      push({ tone: 'error', title: 'Invalid weight/volume', description: 'Weight and volume must be greater than zero.' });
      return;
    }
    const booking = createMockBooking({
      customerPartnerId: Number(form.customerPartnerId),
      originAirportId: Number(form.originAirportId),
      destAirportId: Number(form.destAirportId),
      weightKg,
      volumeCbm,
      commodity: form.commodity,
      notes: form.notes,
    });
    setBookings((prev) => [...prev, booking]);
    push({ tone: 'success', title: 'Booking created', description: `${booking.awb_number} added to the unassigned pool.` });
    setNewBookingOpen(false);
    setForm(emptyBookingForm());
  }

  return (
    <div className="air-schedule-page">
      <div className="page-head">
        <h1>Air Cargo Schedule</h1>
        <span className="pill pill--warning">Sample data — not yet connected to Odoo</span>
      </div>
      <p className="muted">
        Staff console for assigning customer cargo bookings to cargo flights. This preview uses fixed
        sample flights and bookings while the <code>freight_schedule</code> Odoo addon extension is
        being built (Docs/CR/air_schedule.md, Fase 0). Nothing here reflects real bookings yet, and
        actions here don't reach Odoo.
      </p>

      <div className="kpi-grid kpi-grid--5">
        <button type="button" className={`kpi${statusFilter === '' ? ' is-selected' : ''}`} onClick={() => setStatusFilter('')}>
          <div className="kpi__top"><span className="status-dot status-dot--primary" aria-hidden="true" /></div>
          <div className="kpi__value">{enrichedFlights.length}</div>
          <div className="kpi__label">All Flights</div>
        </button>
        {FLIGHT_STATES.map((s) => (
          <button
            key={s}
            type="button"
            className={`kpi${statusFilter === s ? ' is-selected' : ''}`}
            onClick={() => setStatusFilter(s)}
          >
            <div className="kpi__top">
              <span className={`status-dot status-dot--${s === 'scheduled' ? 'info' : s === 'delayed' ? 'danger' : s === 'arrived' ? 'success' : s === 'cancelled' ? 'neutral' : 'warning'}`} aria-hidden="true" />
            </div>
            <div className="kpi__value">{counts[s]}</div>
            <div className="kpi__label">{FLIGHT_STATE_LABEL[s]}</div>
          </button>
        ))}
      </div>

      <div className="card">
        <div className="vessel-toolbar">
          <div className="vessel-toolbar__left">
            <div className="search-box">
              <SearchIcon />
              <input
                placeholder="Flight no / airline / airport…"
                aria-label="Search flight number, airline, or airport"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select aria-label="Filter by airline" value={airlineFilter} onChange={(e) => setAirlineFilter(e.target.value)}>
              <option value="">All Airlines</option>
              {AIRLINES.map((a) => <option key={a.id} value={a.id}>{a.iata_code} — {a.name}</option>)}
            </select>
            <select aria-label="Filter by origin" value={originFilter} onChange={(e) => setOriginFilter(e.target.value)}>
              <option value="">All Origins</option>
              {AIRPORTS.map((a) => <option key={a.id} value={a.id}>{a.iata_code} — {a.city}</option>)}
            </select>
            <select aria-label="Filter by destination" value={destFilter} onChange={(e) => setDestFilter(e.target.value)}>
              <option value="">All Destinations</option>
              {AIRPORTS.map((a) => <option key={a.id} value={a.id}>{a.iata_code} — {a.city}</option>)}
            </select>
            <label className="vessel-search-field" style={{ flex: '0 0 auto' }}>
              <input type="date" aria-label="ETD from" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </label>
            <label className="vessel-search-field" style={{ flex: '0 0 auto' }}>
              <input type="date" aria-label="ETD to" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </label>
            <button type="button" className="btn-secondary" onClick={clearFilters}>Clear filters</button>
          </div>
        </div>

        <div className="air-schedule-layout">
          <AirScheduleFlightBoard flights={filteredFlights} selectedId={selectedFlightId} onSelect={setSelectedFlightId} />
          <AirScheduleBookingPanel
            flight={selectedFlight}
            assignedBookings={assignedBookings}
            unassignedBookings={unassignedBookings}
            onAssign={handleAssign}
            onUnassign={handleUnassign}
            onNewBooking={() => setNewBookingOpen(true)}
          />
        </div>
      </div>

      {newBookingOpen && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setNewBookingOpen(false); }}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="new-booking-title">
            <h2 className="modal__title" id="new-booking-title">New Booking</h2>
            <form className="form-grid" onSubmit={handleCreateBooking}>
              <label>
                Customer
                <select value={form.customerPartnerId} onChange={(e) => setForm((f) => ({ ...f, customerPartnerId: e.target.value }))}>
                  <option value="">Select customer…</option>
                  {CUSTOMERS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label>
                Origin
                <select value={form.originAirportId} onChange={(e) => setForm((f) => ({ ...f, originAirportId: e.target.value }))}>
                  <option value="">Select origin…</option>
                  {AIRPORTS.map((a) => <option key={a.id} value={a.id}>{a.iata_code} — {a.city}</option>)}
                </select>
              </label>
              <label>
                Destination
                <select value={form.destAirportId} onChange={(e) => setForm((f) => ({ ...f, destAirportId: e.target.value }))}>
                  <option value="">Select destination…</option>
                  {AIRPORTS.map((a) => <option key={a.id} value={a.id}>{a.iata_code} — {a.city}</option>)}
                </select>
              </label>
              <label>
                Commodity
                <select value={form.commodity} onChange={(e) => setForm((f) => ({ ...f, commodity: e.target.value }))}>
                  {COMMODITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label>
                Weight (kg)
                <input type="number" min="0" step="0.1" value={form.weightKg} onChange={(e) => setForm((f) => ({ ...f, weightKg: e.target.value }))} />
              </label>
              <label>
                Volume (cbm)
                <input type="number" min="0" step="0.1" value={form.volumeCbm} onChange={(e) => setForm((f) => ({ ...f, volumeCbm: e.target.value }))} />
              </label>
              <label>
                Notes (optional)
                <textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
              </label>
              <div className="modal__actions">
                <button type="button" onClick={() => setNewBookingOpen(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Create booking</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

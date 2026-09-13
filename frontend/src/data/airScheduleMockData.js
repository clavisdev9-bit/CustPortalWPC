// Mock dataset for the Air Cargo Schedule prototype (Docs/CR/air_schedule.md, Fase 0 — blocking).
// This is NOT a copy of a real Odoo model -- the addon that would own this data (`freight_schedule`,
// extended per CR §6 with `freight.flight`/`freight.airline`/`freight.airport`/`freight.cargo.booking`)
// doesn't exist yet (CR §1 Temuan 1). Everything here is in-memory only, so the page built on top of
// it carries a visible "Sample data" label and nothing here is ever sent to `src/api`.
//
// Shape mirrors the planned API response (CR §8) on purpose, so swapping this file for a real
// `frontend/src/api/airSchedule.js` module in Fase 1 doesn't require reshaping the pages.
//
// D-3/AS-3 (read this before "fixing" anything here): staff see bookings across ALL customers on
// the same company, not just one. That's why BOOKINGS below deliberately mixes several different
// `customer_partner_id` values on the very same flight -- that's the feature working, not a filter
// that was forgotten.

export const AIRLINES = [
  { id: 1, name: 'Garuda Cargo', iata_code: 'GA' },
  { id: 2, name: 'Lion Parcel Cargo', iata_code: 'JT' },
  { id: 3, name: 'Cathay Cargo', iata_code: 'CX' },
];

export const AIRPORTS = [
  { id: 10, iata_code: 'CGK', name: 'Soekarno-Hatta', city: 'Jakarta', tz: 'Asia/Jakarta' },
  { id: 11, iata_code: 'SUB', name: 'Juanda', city: 'Surabaya', tz: 'Asia/Jakarta' },
  { id: 12, iata_code: 'DPS', name: 'Ngurah Rai', city: 'Denpasar', tz: 'Asia/Makassar' },
  { id: 13, iata_code: 'SIN', name: 'Changi', city: 'Singapore', tz: 'Asia/Singapore' },
  { id: 14, iata_code: 'HKG', name: 'Hong Kong Intl', city: 'Hong Kong', tz: 'Asia/Hong_Kong' },
];

// Mock "target" customers for the New Booking form (D-5): staff picks one of these, mirroring
// `OdooPartnerService.findByIdViaSession` validating a real partner in the connection -- these are
// NOT the identity of the logged-in staff member, they're who the booking belongs to.
export const CUSTOMERS = [
  { id: 2001, name: 'PT Sinar Abadi Textile' },
  { id: 2002, name: 'CV Berkah Elektronik' },
  { id: 2003, name: 'PT Nusantara Furniture' },
  { id: 2004, name: 'Toko Maju Jaya' },
  { id: 2005, name: 'PT Cahaya Logistik' },
];

export const COMMODITIES = ['Textile', 'Electronics', 'Furniture Parts', 'Machinery Parts', 'Handicraft', 'General Cargo'];

function airline(id) { return AIRLINES.find((a) => a.id === id); }
function airport(id) { return AIRPORTS.find((a) => a.id === id); }
function customer(id) { return CUSTOMERS.find((c) => c.id === id); }

// state (D-8): 'scheduled' | 'loading' | 'departed' | 'delayed' | 'arrived' | 'cancelled' — computed
// from ETD/ATD/ATA in the real system, never hand-typed (D-8/D-5 Vessel Schedule precedent). Fixed
// here since there's no backend yet to compute it.
const RAW_FLIGHTS = [
  {
    id: 501, flight_no: 'GA-6512', airline_id: 1, origin_airport_id: 10, dest_airport_id: 11,
    etd: '2026-09-13T00:40:00Z', eta: '2026-09-13T01:55:00Z', atd: '2026-09-13T00:38:00Z', ata: null,
    state: 'departed', capacity_kg: 9000, capacity_cbm: 52, aircraft_type: 'B737F',
    updated_at: '2026-09-13T00:38:04Z',
  },
  {
    id: 502, flight_no: 'JT-771', airline_id: 2, origin_airport_id: 10, dest_airport_id: 12,
    etd: '2026-09-13T03:00:00Z', eta: '2026-09-13T05:10:00Z', atd: null, ata: null,
    state: 'loading', capacity_kg: 6000, capacity_cbm: 34, aircraft_type: 'A330F',
    updated_at: '2026-09-12T22:00:00Z',
  },
  {
    id: 503, flight_no: 'CX-778', airline_id: 3, origin_airport_id: 13, dest_airport_id: 14,
    etd: '2026-09-13T09:15:00Z', eta: '2026-09-13T13:00:00Z', atd: null, ata: null,
    state: 'scheduled', capacity_kg: 15000, capacity_cbm: 90, aircraft_type: 'B747F',
    updated_at: '2026-09-11T08:00:00Z',
  },
  {
    id: 504, flight_no: 'GA-6520', airline_id: 1, origin_airport_id: 11, dest_airport_id: 10,
    etd: '2026-09-13T14:00:00Z', eta: '2026-09-13T15:15:00Z', atd: null, ata: null,
    state: 'delayed', capacity_kg: 9000, capacity_cbm: 52, aircraft_type: 'B737F',
    updated_at: '2026-09-13T05:00:00Z',
  },
  {
    id: 505, flight_no: 'JT-780', airline_id: 2, origin_airport_id: 12, dest_airport_id: 10,
    etd: '2026-09-12T20:00:00Z', eta: '2026-09-12T22:10:00Z', atd: '2026-09-12T20:05:00Z', ata: '2026-09-12T22:00:00Z',
    state: 'arrived', capacity_kg: 6000, capacity_cbm: 34, aircraft_type: 'A330F',
    updated_at: '2026-09-12T22:05:00Z',
  },
  {
    id: 506, flight_no: 'GA-6530', airline_id: 1, origin_airport_id: 10, dest_airport_id: 13,
    etd: '2026-09-11T06:00:00Z', eta: '2026-09-11T09:00:00Z', atd: null, ata: null,
    state: 'cancelled', capacity_kg: 9000, capacity_cbm: 52, aircraft_type: 'B737F',
    updated_at: '2026-09-10T12:00:00Z',
  },
  {
    id: 507, flight_no: 'CX-782', airline_id: 3, origin_airport_id: 14, dest_airport_id: 10,
    etd: '2026-09-14T02:00:00Z', eta: '2026-09-14T07:30:00Z', atd: null, ata: null,
    state: 'scheduled', capacity_kg: 15000, capacity_cbm: 90, aircraft_type: 'B747F',
    updated_at: '2026-09-12T09:00:00Z',
  },
  {
    id: 508, flight_no: 'JT-790', airline_id: 2, origin_airport_id: 10, dest_airport_id: 11,
    etd: '2026-09-14T08:00:00Z', eta: '2026-09-14T09:15:00Z', atd: null, ata: null,
    state: 'scheduled', capacity_kg: 6000, capacity_cbm: 34, aircraft_type: 'A330F',
    updated_at: '2026-09-12T09:00:00Z',
  },
];

export const FLIGHTS = RAW_FLIGHTS.map((f) => ({
  ...f,
  airline: airline(f.airline_id),
  origin: airport(f.origin_airport_id),
  dest: airport(f.dest_airport_id),
}));

// state (Q-5): 'unassigned' | 'assigned' | 'loaded' | 'in_transit' | 'delivered' | 'cancelled'.
// `flight_id: null` is the unassigned pool (CR §2.2 glossary).
const RAW_BOOKINGS = [
  // -- flight 501 (GA-6512, CGK→SUB, cap 9000kg/52cbm) -- two different customers, matches CR §8
  // sample response exactly (used_kg 5500 / used_cbm 30 / booking_count 2).
  { id: 9001, awb_number: 'GA1-00012345', customer_partner_id: 2001, origin_airport_id: 10, dest_airport_id: 11, weight_kg: 3200, volume_cbm: 18, commodity: 'Textile', flight_id: 501, state: 'assigned', notes: '', updated_at: '2026-09-12T23:00:00Z' },
  { id: 9002, awb_number: 'GA1-00012346', customer_partner_id: 2002, origin_airport_id: 10, dest_airport_id: 11, weight_kg: 2300, volume_cbm: 12, commodity: 'Electronics', flight_id: 501, state: 'assigned', notes: '', updated_at: '2026-09-12T23:10:00Z' },

  // -- flight 502 (JT-771, CGK→DPS, cap 6000kg/34cbm) -- two different customers.
  { id: 9003, awb_number: 'JT7-00098765', customer_partner_id: 2003, origin_airport_id: 10, dest_airport_id: 12, weight_kg: 1800, volume_cbm: 9, commodity: 'Furniture Parts', flight_id: 502, state: 'assigned', notes: '', updated_at: '2026-09-12T20:00:00Z' },
  { id: 9004, awb_number: 'JT7-00098766', customer_partner_id: 2001, origin_airport_id: 10, dest_airport_id: 12, weight_kg: 900, volume_cbm: 5, commodity: 'Textile', flight_id: 502, state: 'assigned', notes: '', updated_at: '2026-09-12T20:05:00Z' },

  // -- flight 503 (CX-778, SIN→HKG, cap 15000kg/90cbm).
  { id: 9005, awb_number: 'CX7-00055123', customer_partner_id: 2005, origin_airport_id: 13, dest_airport_id: 14, weight_kg: 8000, volume_cbm: 40, commodity: 'Machinery Parts', flight_id: 503, state: 'assigned', notes: '', updated_at: '2026-09-11T09:00:00Z' },

  // -- flight 505 (JT-780, arrived) -- booking lifecycle moved past "assigned".
  { id: 9006, awb_number: 'JT7-00098700', customer_partner_id: 2004, origin_airport_id: 12, dest_airport_id: 10, weight_kg: 1200, volume_cbm: 6, commodity: 'Handicraft', flight_id: 505, state: 'delivered', notes: '', updated_at: '2026-09-12T22:15:00Z' },

  // -- flight 506 (cancelled) -- booking cancelled along with the flight (Q-5: state, never unlink).
  { id: 9007, awb_number: 'GA1-00012300', customer_partner_id: 2002, origin_airport_id: 10, dest_airport_id: 13, weight_kg: 500, volume_cbm: 3, commodity: 'Electronics', flight_id: 506, state: 'cancelled', notes: 'Flight cancelled', updated_at: '2026-09-10T12:05:00Z' },

  // -- unassigned pool -- not yet linked to any flight.
  { id: 9010, awb_number: 'GA1-00012350', customer_partner_id: 2001, origin_airport_id: 10, dest_airport_id: 11, weight_kg: 1500, volume_cbm: 8, commodity: 'Textile', flight_id: null, state: 'unassigned', notes: '', updated_at: '2026-09-12T10:00:00Z' },
  { id: 9011, awb_number: 'JT7-00098780', customer_partner_id: 2003, origin_airport_id: 10, dest_airport_id: 12, weight_kg: 2200, volume_cbm: 11, commodity: 'Furniture Parts', flight_id: null, state: 'unassigned', notes: '', updated_at: '2026-09-12T10:15:00Z' },
  { id: 9012, awb_number: 'CX7-00055200', customer_partner_id: 2005, origin_airport_id: 13, dest_airport_id: 14, weight_kg: 4000, volume_cbm: 22, commodity: 'Machinery Parts', flight_id: null, state: 'unassigned', notes: '', updated_at: '2026-09-12T11:00:00Z' },
  { id: 9013, awb_number: 'GA1-00012360', customer_partner_id: 2004, origin_airport_id: 10, dest_airport_id: 13, weight_kg: 600, volume_cbm: 3.5, commodity: 'Handicraft', flight_id: null, state: 'unassigned', notes: '', updated_at: '2026-09-12T11:30:00Z' },
  { id: 9014, awb_number: 'JT7-00098790', customer_partner_id: 2002, origin_airport_id: 10, dest_airport_id: 11, weight_kg: 3100, volume_cbm: 16, commodity: 'Electronics', flight_id: null, state: 'unassigned', notes: '', updated_at: '2026-09-12T12:00:00Z' },
];

export function enrichBooking(b) {
  return {
    ...b,
    customer: customer(b.customer_partner_id),
    origin: airport(b.origin_airport_id),
    dest: airport(b.dest_airport_id),
  };
}

export const BOOKINGS = RAW_BOOKINGS.map(enrichBooking);

export const FLIGHT_STATE_LABEL = {
  scheduled: 'Scheduled',
  loading: 'Loading',
  departed: 'Departed',
  delayed: 'Delayed',
  arrived: 'Arrived',
  cancelled: 'Cancelled',
};

export const FLIGHT_STATE_TONE = {
  scheduled: 'info',
  loading: 'warning',
  departed: 'warning',
  delayed: 'danger',
  arrived: 'success',
  cancelled: 'neutral',
};

export const FLIGHT_STATES = Object.keys(FLIGHT_STATE_LABEL);

export const BOOKING_STATE_LABEL = {
  unassigned: 'Unassigned',
  assigned: 'Assigned',
  loaded: 'Loaded',
  in_transit: 'In Transit',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export const BOOKING_STATE_TONE = {
  unassigned: 'neutral',
  assigned: 'info',
  loaded: 'warning',
  in_transit: 'warning',
  delivered: 'success',
  cancelled: 'danger',
};

let nextBookingId = 9100;
let nextAwbSerial = 90000;

// Mock stand-in for `POST /air-schedule/bookings` (CR §8). `customerPartnerId` here is a value the
// caller picked from a fixed dropdown (CUSTOMERS) instead of a real Odoo partner search -- it plays
// the same "target, not identity" role that D-5 describes, just without a real backend to validate
// against yet.
export function createMockBooking({ customerPartnerId, originAirportId, destAirportId, weightKg, volumeCbm, commodity, notes }) {
  const airlinePrefix = AIRLINES[0].iata_code[0] + '1';
  const awb = `${airlinePrefix}-${String(nextAwbSerial++).padStart(8, '0')}`;
  const booking = {
    id: nextBookingId++,
    awb_number: awb,
    customer_partner_id: customerPartnerId,
    origin_airport_id: originAirportId,
    dest_airport_id: destAirportId,
    weight_kg: weightKg,
    volume_cbm: volumeCbm,
    commodity,
    flight_id: null,
    state: 'unassigned',
    notes: notes || '',
    updated_at: new Date().toISOString(),
  };
  return enrichBooking(booking);
}

// Mock dataset for the Vessel Schedule prototype (Fase 0-P, Docs/CR/customer_portal_vessel_schedule.md).
// This is NOT a copy of a real Odoo model -- the addon that would own this data (`freight_schedule`,
// see CR §6) doesn't exist yet. Everything here is in-memory only, so every page built on top of it
// carries a visible "Sample data" label (CR §12, R-10) and nothing here is ever sent to `src/api`.
//
// Shape mirrors the planned API response (CR §10) on purpose, so swapping this file for a real
// `frontend/src/api/vesselSchedule.js` module in Fase 1 doesn't require reshaping the pages.

export const PORTS = [
  { id: 1, code: 'SGSIN', name: 'Singapore', tz: 'Asia/Singapore' },
  { id: 2, code: 'IDJKT', name: 'Jakarta (Tanjung Priok)', tz: 'Asia/Jakarta' },
  { id: 3, code: 'IDSUB', name: 'Surabaya (Tanjung Perak)', tz: 'Asia/Jakarta' },
  { id: 4, code: 'MYPKG', name: 'Port Klang', tz: 'Asia/Kuala_Lumpur' },
  { id: 5, code: 'CNSHA', name: 'Shanghai', tz: 'Asia/Shanghai' },
  { id: 6, code: 'AUPER', name: 'Fremantle (Perth)', tz: 'Australia/Perth' },
  { id: 7, code: 'KRPUS', name: 'Busan', tz: 'Asia/Seoul' },
];

export const VESSELS = [
  { id: 22, name: 'SINAR BAHARI', imo_number: '9323456', vessel_type: 'Container Ship', capacity_teu: 4200, flag: 'Indonesia', operator: 'PT Samudera Line' },
  { id: 23, name: 'MERATUS PERKASA', imo_number: '9187654', vessel_type: 'Container Ship', capacity_teu: 2800, flag: 'Indonesia', operator: 'Meratus Line' },
  { id: 24, name: 'EVER HORIZON', imo_number: '9456123', vessel_type: 'Container Ship', capacity_teu: 8600, flag: 'Panama', operator: 'Evergreen Marine' },
  { id: 25, name: 'TANTO PRIMA', imo_number: '9299887', vessel_type: 'Container Ship', capacity_teu: 1600, flag: 'Indonesia', operator: 'Tanto Intim Line' },
];

function port(code) {
  return PORTS.find((p) => p.code === code);
}
function vessel(id) {
  return VESSELS.find((v) => v.id === id);
}

// state (D-5): 'scheduled' | 'departed' | 'arrived' | 'delayed' | 'cancelled'.
export const VOYAGES = [
  {
    id: 1841, voyage_no: '037N', vessel_id: 22, service_type: 'direct',
    pol: 'SGSIN', pod: 'IDJKT',
    etd: '2026-09-12T02:00:00Z', eta: '2026-09-15T01:00:00Z', atd: null, ata: null,
    state: 'scheduled', updated_at: '2026-09-09T04:11:07Z', remarks: '',
    legs: [
      { sequence: 1, port: 'SGSIN', leg_type: 'load', etd: '2026-09-12T02:00:00Z', atd: null, terminal: 'PSA Terminal' },
      { sequence: 2, port: 'IDJKT', leg_type: 'discharge', eta: '2026-09-15T01:00:00Z', ata: null, terminal: 'Tanjung Priok' },
    ],
  },
  {
    id: 1842, voyage_no: '015E', vessel_id: 23, service_type: 'direct',
    pol: 'IDJKT', pod: 'IDSUB',
    etd: '2026-09-10T20:00:00Z', eta: '2026-09-12T09:00:00Z', atd: '2026-09-10T21:15:00Z', ata: null,
    state: 'departed', updated_at: '2026-09-11T06:00:00Z', remarks: '',
    legs: [
      { sequence: 1, port: 'IDJKT', leg_type: 'load', etd: '2026-09-10T20:00:00Z', atd: '2026-09-10T21:15:00Z', terminal: 'Tanjung Priok' },
      { sequence: 2, port: 'IDSUB', leg_type: 'discharge', eta: '2026-09-12T09:00:00Z', ata: null, terminal: 'Tanjung Perak' },
    ],
  },
  {
    id: 1843, voyage_no: '210W', vessel_id: 24, service_type: 'transship',
    pol: 'CNSHA', pod: 'IDJKT',
    etd: '2026-09-05T14:00:00Z', eta: '2026-09-20T08:00:00Z', atd: '2026-09-05T15:40:00Z', ata: null,
    state: 'delayed', updated_at: '2026-09-13T02:00:00Z',
    remarks: 'Held at Busan for berth congestion; ETA revised +2 days from original schedule.',
    legs: [
      { sequence: 1, port: 'CNSHA', leg_type: 'load', etd: '2026-09-05T14:00:00Z', atd: '2026-09-05T15:40:00Z', terminal: 'Yangshan Terminal' },
      { sequence: 2, port: 'KRPUS', leg_type: 'transship', eta: '2026-09-10T06:00:00Z', ata: '2026-09-10T07:20:00Z', etd: '2026-09-12T02:00:00Z', atd: null, terminal: 'Busan New Port' },
      { sequence: 3, port: 'IDJKT', leg_type: 'discharge', eta: '2026-09-20T08:00:00Z', ata: null, terminal: 'Tanjung Priok' },
    ],
  },
  {
    id: 1844, voyage_no: '099N', vessel_id: 25, service_type: 'direct',
    pol: 'IDSUB', pod: 'MYPKG',
    etd: '2026-08-28T10:00:00Z', eta: '2026-09-02T03:00:00Z', atd: '2026-08-28T10:20:00Z', ata: '2026-09-02T02:40:00Z',
    state: 'arrived', updated_at: '2026-09-02T03:10:00Z', remarks: '',
    legs: [
      { sequence: 1, port: 'IDSUB', leg_type: 'load', etd: '2026-08-28T10:00:00Z', atd: '2026-08-28T10:20:00Z', terminal: 'Tanjung Perak' },
      { sequence: 2, port: 'MYPKG', leg_type: 'discharge', eta: '2026-09-02T03:00:00Z', ata: '2026-09-02T02:40:00Z', terminal: 'Westport' },
    ],
  },
  {
    id: 1845, voyage_no: '044W', vessel_id: 22, service_type: 'direct',
    pol: 'MYPKG', pod: 'SGSIN',
    etd: '2026-09-18T06:00:00Z', eta: '2026-09-19T04:00:00Z', atd: null, ata: null,
    state: 'scheduled', updated_at: '2026-09-08T09:00:00Z', remarks: '',
    legs: [
      { sequence: 1, port: 'MYPKG', leg_type: 'load', etd: '2026-09-18T06:00:00Z', atd: null, terminal: 'Westport' },
      { sequence: 2, port: 'SGSIN', leg_type: 'discharge', eta: '2026-09-19T04:00:00Z', ata: null, terminal: 'PSA Terminal' },
    ],
  },
  {
    id: 1846, voyage_no: '121S', vessel_id: 24, service_type: 'direct',
    pol: 'IDJKT', pod: 'AUPER',
    etd: '2026-09-25T12:00:00Z', eta: '2026-10-03T05:00:00Z', atd: null, ata: null,
    state: 'scheduled', updated_at: '2026-09-07T11:00:00Z', remarks: '',
    legs: [
      { sequence: 1, port: 'IDJKT', leg_type: 'load', etd: '2026-09-25T12:00:00Z', atd: null, terminal: 'Tanjung Priok' },
      { sequence: 2, port: 'AUPER', leg_type: 'discharge', eta: '2026-10-03T05:00:00Z', ata: null, terminal: 'Fremantle Port' },
    ],
  },
  {
    id: 1847, voyage_no: '007C', vessel_id: 23, service_type: 'direct',
    pol: 'SGSIN', pod: 'IDJKT',
    etd: '2026-09-01T09:00:00Z', eta: '2026-09-04T02:00:00Z', atd: null, ata: null,
    state: 'cancelled', updated_at: '2026-09-03T15:00:00Z',
    remarks: 'Cancelled due to vessel rotation change; next available sailing is voyage 037N.',
    legs: [
      { sequence: 1, port: 'SGSIN', leg_type: 'load', etd: '2026-09-01T09:00:00Z', atd: null, terminal: 'PSA Terminal' },
      { sequence: 2, port: 'IDJKT', leg_type: 'discharge', eta: '2026-09-04T02:00:00Z', ata: null, terminal: 'Tanjung Priok' },
    ],
  },
  {
    id: 1848, voyage_no: '056N', vessel_id: 25, service_type: 'direct',
    pol: 'IDJKT', pod: 'IDSUB',
    etd: '2026-09-14T22:00:00Z', eta: '2026-09-16T08:00:00Z', atd: null, ata: null,
    state: 'scheduled', updated_at: '2026-09-10T05:30:00Z', remarks: '',
    legs: [
      { sequence: 1, port: 'IDJKT', leg_type: 'load', etd: '2026-09-14T22:00:00Z', atd: null, terminal: 'Tanjung Priok' },
      { sequence: 2, port: 'IDSUB', leg_type: 'discharge', eta: '2026-09-16T08:00:00Z', ata: null, terminal: 'Tanjung Perak' },
    ],
  },
].map((v) => ({
  ...v,
  vessel: vessel(v.vessel_id),
  pol: port(v.pol),
  pod: port(v.pod),
  legs: v.legs.map((l) => ({ ...l, port: port(l.port) })),
}));

// Pill tone per state (D-5). Kept separate from the generic StatusBadge component the same way
// ShipmentStatusBadge is: "Cancelled" here isn't the danger case ("Delayed" is), so the generic
// keyword-based badge would classify these backwards.
export const STATE_TONE = {
  scheduled: 'info',
  departed: 'warning',
  arrived: 'success',
  delayed: 'danger',
  cancelled: 'neutral',
};

export const STATE_LABEL = {
  scheduled: 'On Schedule',
  departed: 'Departed',
  arrived: 'Arrived',
  delayed: 'Delayed',
  cancelled: 'Cancelled',
};

export const LEG_TYPE_LABEL = {
  load: 'Load (POL)',
  transship: 'Transshipment',
  discharge: 'Discharge (POD)',
};

export const STATES = Object.keys(STATE_LABEL);

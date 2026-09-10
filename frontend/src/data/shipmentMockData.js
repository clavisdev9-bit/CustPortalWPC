// Mock dataset for the Shipment Tracking prototype (Docs/CR/prompt-shipment-tracking-interactive-prototype_1.md).
// Ported verbatim from the static reference Docs/mockup/portway-shipment-tracking-prototype.html so
// List and Detail views stay consistent. No backend involved -- CR explicitly scopes this to an
// in-memory mock, so this is intentionally the only "source of truth" for the feature.

export const SHIPMENTS = [
  {
    id: 'SHP-2026-04831', container: 'TCLU4829107', bl: 'BLPTW48311', booking: 'BKPTW10091',
    mode: 'Ocean', status: 'In Transit', origin: 'Shanghai, CN', destination: 'Los Angeles, US',
    etd: '2026-08-14', eta: '2026-09-18',
    timeline: [
      { label: 'Booking confirmed', place: 'Shanghai, CN', time: '2026-08-10 09:12', note: 'Booking confirmed with carrier OceanLine. Container allocation TCLU4829107 assigned.', state: 'done' },
      { label: 'Departed origin port', place: 'Shanghai, CN', time: '2026-08-14 22:40', note: 'Vessel Ever Compass departed Yangshan Terminal on schedule.', state: 'done' },
      { label: 'Transshipment', place: 'Busan, KR', time: '2026-08-19 06:05', note: 'Transshipped to vessel Pacific Horizon at Busan New Port, 4-hour connection window.', state: 'done' },
      { label: 'In transit — mid ocean', place: 'North Pacific', time: '2026-09-02 00:00', note: 'Vessel tracking nominal, no weather deviations reported.', state: 'current' },
      { label: 'Arrival at destination port', place: 'Los Angeles, US', time: 'Est. 2026-09-18', note: 'Awaiting berth confirmation at Los Angeles port complex.', state: 'pending' },
      { label: 'Customs clearance', place: 'Los Angeles, US', time: 'Est. 2026-09-19', note: 'Customs clearance to be initiated on arrival.', state: 'pending' },
    ],
    map: [
      { type: 'origin', name: 'Shanghai, CN', x: 78, y: 44, time: '2026-08-14 22:40' },
      { type: 'transship', name: 'Busan, KR', x: 82, y: 36, time: '2026-08-19 06:05' },
      { type: 'current', name: 'North Pacific (current position)', x: 48, y: 32, time: '2026-09-02 00:00' },
      { type: 'destination', name: 'Los Angeles, US', x: 14, y: 40, time: 'Est. 2026-09-18' },
    ],
    documents: [
      { name: 'Bill of Lading', available: true, sub: 'PDF · 214 KB' },
      { name: 'Commercial Invoice', available: true, sub: 'PDF · 98 KB' },
      { name: 'Packing List', available: true, sub: 'PDF · 76 KB' },
      { name: 'Certificate of Origin', available: false, sub: 'Not yet available' },
      { name: 'Customs Declaration', available: false, sub: 'Not yet available' },
    ],
  },
  {
    id: 'SHP-2026-04812', container: 'MSKU7728341', bl: 'BLPTW48122', booking: 'BKPTW10088',
    mode: 'Ocean', status: 'Delayed', origin: 'Ningbo, CN', destination: 'Rotterdam, NL',
    etd: '2026-08-02', eta: '2026-09-12',
    timeline: [
      { label: 'Booking confirmed', place: 'Ningbo, CN', time: '2026-07-28 11:00', note: 'Booking confirmed with carrier MaerskLine.', state: 'done' },
      { label: 'Departed origin port', place: 'Ningbo, CN', time: '2026-08-02 14:20', note: 'Vessel MSC Aurora departed Ningbo-Zhoushan port.', state: 'done' },
      { label: 'Port congestion delay', place: 'Singapore, SG', time: '2026-08-20 08:00', note: 'Vessel held at Singapore anchorage due to port congestion; new ETA revised by 7 days.', state: 'current' },
      { label: 'Transshipment', place: 'Singapore, SG', time: 'Est. 2026-08-24', note: 'Awaiting berth window for transshipment to Rotterdam-bound vessel.', state: 'pending' },
      { label: 'Arrival at destination port', place: 'Rotterdam, NL', time: 'Est. 2026-09-12', note: 'Revised ETA reflects congestion delay.', state: 'pending' },
    ],
    map: [
      { type: 'origin', name: 'Ningbo, CN', x: 80, y: 46, time: '2026-08-02 14:20' },
      { type: 'current', name: 'Singapore, SG (delayed)', x: 74, y: 58, time: '2026-08-20 08:00' },
      { type: 'destination', name: 'Rotterdam, NL', x: 22, y: 16, time: 'Est. 2026-09-12' },
    ],
    documents: [
      { name: 'Bill of Lading', available: true, sub: 'PDF · 201 KB' },
      { name: 'Commercial Invoice', available: true, sub: 'PDF · 104 KB' },
      { name: 'Packing List', available: false, sub: 'Not yet available' },
      { name: 'Certificate of Origin', available: false, sub: 'Not yet available' },
    ],
  },
  {
    id: 'SHP-2026-04790', container: '—', bl: '—', booking: 'BKPTW10079',
    mode: 'Air', status: 'Arriving Soon', origin: 'Hong Kong, HK', destination: 'Chicago, US',
    etd: '2026-09-06', eta: '2026-09-12',
    timeline: [
      { label: 'Booking confirmed', place: 'Hong Kong, HK', time: '2026-09-03 10:00', note: 'Air waybill issued with carrier CathayCargo.', state: 'done' },
      { label: 'Departed origin airport', place: 'Hong Kong, HK', time: '2026-09-06 23:10', note: 'Flight CX-889F departed HKG cargo terminal.', state: 'done' },
      { label: 'Transit hub', place: 'Anchorage, US', time: '2026-09-07 09:40', note: 'Brief refuel stop, cargo remained on board.', state: 'done' },
      { label: 'Arriving soon', place: 'Chicago, US', time: 'Est. 2026-09-12', note: "Final approach to O'Hare cargo facility, on schedule.", state: 'current' },
      { label: 'Customs clearance', place: 'Chicago, US', time: 'Est. 2026-09-12', note: 'Customs pre-clearance documents submitted.', state: 'pending' },
    ],
    map: [
      { type: 'origin', name: 'Hong Kong, HK', x: 80, y: 50, time: '2026-09-06 23:10' },
      { type: 'transship', name: 'Anchorage, US', x: 20, y: 14, time: '2026-09-07 09:40' },
      { type: 'current', name: 'En route to Chicago', x: 16, y: 30, time: 'In flight' },
      { type: 'destination', name: 'Chicago, US', x: 24, y: 34, time: 'Est. 2026-09-12' },
    ],
    documents: [
      { name: 'Air Waybill', available: true, sub: 'PDF · 88 KB' },
      { name: 'Commercial Invoice', available: true, sub: 'PDF · 91 KB' },
      { name: 'Packing List', available: true, sub: 'PDF · 64 KB' },
    ],
  },
  {
    id: 'SHP-2026-04773', container: 'HLXU2210984', bl: 'BLPTW47731', booking: 'BKPTW10065',
    mode: 'Ocean', status: 'Delivered', origin: 'Busan, KR', destination: 'Long Beach, US',
    etd: '2026-07-20', eta: '2026-08-22',
    timeline: [
      { label: 'Booking confirmed', place: 'Busan, KR', time: '2026-07-16 09:00', note: 'Booking confirmed with carrier Hapag-Lloyd.', state: 'done' },
      { label: 'Departed origin port', place: 'Busan, KR', time: '2026-07-20 19:15', note: 'Vessel HL Trust departed Busan New Port.', state: 'done' },
      { label: 'Arrival at destination port', place: 'Long Beach, US', time: '2026-08-21 07:30', note: 'Vessel berthed one day ahead of schedule.', state: 'done' },
      { label: 'Customs cleared', place: 'Long Beach, US', time: '2026-08-22 13:00', note: 'Customs clearance completed without inspection hold.', state: 'done' },
      { label: 'Delivered to consignee', place: 'Long Beach, US', time: '2026-08-22 17:45', note: 'Container delivered to consignee warehouse, POD signed.', state: 'done' },
    ],
    map: [
      { type: 'origin', name: 'Busan, KR', x: 82, y: 38, time: '2026-07-20 19:15' },
      { type: 'destination', name: 'Long Beach, US', x: 16, y: 44, time: '2026-08-22 17:45' },
      { type: 'current', name: 'Delivered — Long Beach, US', x: 16, y: 44, time: '2026-08-22 17:45' },
    ],
    documents: [
      { name: 'Bill of Lading', available: true, sub: 'PDF · 198 KB' },
      { name: 'Commercial Invoice', available: true, sub: 'PDF · 95 KB' },
      { name: 'Packing List', available: true, sub: 'PDF · 70 KB' },
      { name: 'Customs Declaration', available: true, sub: 'PDF · 112 KB' },
      { name: 'Proof of Delivery', available: true, sub: 'PDF · 55 KB' },
    ],
  },
  {
    id: 'SHP-2026-04756', container: 'CMAU9012763', bl: 'BLPTW47561', booking: 'BKPTW10054',
    mode: 'Ocean', status: 'In Transit', origin: 'Singapore, SG', destination: 'Hamburg, DE',
    etd: '2026-08-25', eta: '2026-09-29',
    timeline: [
      { label: 'Booking confirmed', place: 'Singapore, SG', time: '2026-08-20 15:00', note: 'Booking confirmed with carrier CMA CGM.', state: 'done' },
      { label: 'Departed origin port', place: 'Singapore, SG', time: '2026-08-25 20:00', note: 'Vessel CMA CGM Bellini departed PSA Terminal.', state: 'done' },
      { label: 'In transit — Indian Ocean', place: 'Indian Ocean', time: '2026-09-04 00:00', note: 'On schedule, next stop Jebel Ali for transshipment.', state: 'current' },
      { label: 'Transshipment', place: 'Jebel Ali, AE', time: 'Est. 2026-09-10', note: 'Scheduled transshipment window pending confirmation.', state: 'pending' },
      { label: 'Arrival at destination port', place: 'Hamburg, DE', time: 'Est. 2026-09-29', note: 'Final leg via Suez Canal route.', state: 'pending' },
    ],
    map: [
      { type: 'origin', name: 'Singapore, SG', x: 74, y: 58, time: '2026-08-25 20:00' },
      { type: 'current', name: 'Indian Ocean (current position)', x: 60, y: 56, time: '2026-09-04 00:00' },
      { type: 'transship', name: 'Jebel Ali, AE', x: 52, y: 44, time: 'Est. 2026-09-10' },
      { type: 'destination', name: 'Hamburg, DE', x: 26, y: 14, time: 'Est. 2026-09-29' },
    ],
    documents: [
      { name: 'Bill of Lading', available: true, sub: 'PDF · 210 KB' },
      { name: 'Commercial Invoice', available: true, sub: 'PDF · 89 KB' },
      { name: 'Packing List', available: false, sub: 'Not yet available' },
    ],
  },
  {
    id: 'SHP-2026-04701', container: '—', bl: '—', booking: 'BKPTW10041',
    mode: 'Road', status: 'Cancelled', origin: 'Guangzhou, CN', destination: 'Shenzhen, CN',
    etd: '2026-08-10', eta: '2026-08-11',
    timeline: [
      { label: 'Booking confirmed', place: 'Guangzhou, CN', time: '2026-08-06 10:00', note: 'Road booking confirmed for cross-city transfer.', state: 'done' },
      { label: 'Shipment cancelled', place: 'Guangzhou, CN', time: '2026-08-09 16:20', note: "Cancelled at shipper's request prior to dispatch; no charges applied.", state: 'done' },
    ],
    map: [
      { type: 'origin', name: 'Guangzhou, CN', x: 78, y: 52, time: '2026-08-06 10:00' },
      { type: 'destination', name: 'Shenzhen, CN (cancelled)', x: 79, y: 54, time: '—' },
      { type: 'current', name: 'Cancelled before dispatch', x: 78, y: 52, time: '2026-08-09 16:20' },
    ],
    documents: [
      { name: 'Booking Confirmation', available: true, sub: 'PDF · 40 KB' },
      { name: 'Cancellation Notice', available: true, sub: 'PDF · 22 KB' },
    ],
  },
  {
    id: 'SHP-2026-04658', container: 'OOLU5563218', bl: 'BLPTW46581', booking: 'BKPTW10032',
    mode: 'Ocean', status: 'Delivered', origin: 'Kaohsiung, TW', destination: 'Oakland, US',
    etd: '2026-07-05', eta: '2026-08-07',
    timeline: [
      { label: 'Booking confirmed', place: 'Kaohsiung, TW', time: '2026-07-01 09:30', note: 'Booking confirmed with carrier OOCL.', state: 'done' },
      { label: 'Departed origin port', place: 'Kaohsiung, TW', time: '2026-07-05 18:00', note: 'Vessel OOCL Faith departed Kaohsiung Terminal.', state: 'done' },
      { label: 'Arrival at destination port', place: 'Oakland, US', time: '2026-08-06 11:20', note: 'Vessel berthed on schedule.', state: 'done' },
      { label: 'Delivered to consignee', place: 'Oakland, US', time: '2026-08-07 14:10', note: 'Container delivered, POD signed by receiving warehouse.', state: 'done' },
    ],
    map: [
      { type: 'origin', name: 'Kaohsiung, TW', x: 80, y: 48, time: '2026-07-05 18:00' },
      { type: 'destination', name: 'Oakland, US', x: 12, y: 38, time: '2026-08-07 14:10' },
      { type: 'current', name: 'Delivered — Oakland, US', x: 12, y: 38, time: '2026-08-07 14:10' },
    ],
    documents: [
      { name: 'Bill of Lading', available: true, sub: 'PDF · 205 KB' },
      { name: 'Commercial Invoice', available: true, sub: 'PDF · 93 KB' },
      { name: 'Packing List', available: true, sub: 'PDF · 68 KB' },
      { name: 'Proof of Delivery', available: true, sub: 'PDF · 51 KB' },
    ],
  },
  {
    id: 'SHP-2026-04430', container: 'MSCU3387206', bl: 'BLPTW44301', booking: 'BKPTW10008',
    mode: 'Ocean', status: 'Delayed', origin: 'Qingdao, CN', destination: 'Antwerp, BE',
    etd: '2026-06-30', eta: '2026-08-02',
    timeline: [
      { label: 'Booking confirmed', place: 'Qingdao, CN', time: '2026-06-25 08:00', note: 'Booking confirmed with carrier MSC.', state: 'done' },
      { label: 'Departed origin port', place: 'Qingdao, CN', time: '2026-06-30 21:00', note: 'Vessel MSC Diletta departed Qingdao Port.', state: 'done' },
      { label: 'Weather delay', place: 'Suez Canal, EG', time: '2026-07-22 05:00', note: 'Convoy delayed 3 days due to adverse weather in the Suez Canal transit zone.', state: 'current' },
      { label: 'Arrival at destination port', place: 'Antwerp, BE', time: 'Est. 2026-08-02', note: 'Revised ETA reflects Suez transit delay.', state: 'pending' },
    ],
    map: [
      { type: 'origin', name: 'Qingdao, CN', x: 80, y: 42, time: '2026-06-30 21:00' },
      { type: 'current', name: 'Suez Canal, EG (delayed)', x: 46, y: 38, time: '2026-07-22 05:00' },
      { type: 'destination', name: 'Antwerp, BE', x: 24, y: 14, time: 'Est. 2026-08-02' },
    ],
    documents: [
      { name: 'Bill of Lading', available: true, sub: 'PDF · 199 KB' },
      { name: 'Commercial Invoice', available: false, sub: 'Not yet available' },
      { name: 'Packing List', available: false, sub: 'Not yet available' },
    ],
  },
];

// Maps each shipment status to one of the portal's existing pill tones (see index.css STATUS
// PILLS) so this feature never introduces its own colors -- dark mode and brand re-theming keep
// working automatically. The generic StatusBadge component's regex can't be reused here: its
// keyword rules classify "Cancelled" as danger and "Delayed"/"Arriving Soon" as neutral, which is
// the opposite of what this CR's semantics call for (blue/green/orange/red/gray).
export const STATUS_TONE = {
  'In Transit': 'info',
  'Arriving Soon': 'warning',
  Delivered: 'success',
  Delayed: 'danger',
  Cancelled: 'neutral',
};

// Route map marker colors, mapped the same way (no hardcoded hex).
export const MARKER_TONE = {
  origin: 'info',
  transship: 'neutral',
  current: 'warning',
  destination: 'success',
};

export const ALL_COLUMNS = [
  { key: 'id', label: 'Shipment ID', sortable: true, always: true },
  { key: 'container', label: 'Container No.', sortable: false },
  { key: 'bl', label: 'B/L Number', sortable: false },
  { key: 'booking', label: 'Booking No.', sortable: false },
  { key: 'mode', label: 'Mode', sortable: true },
  { key: 'origin', label: 'Origin', sortable: true },
  { key: 'destination', label: 'Destination', sortable: true },
  { key: 'etd', label: 'ETD', sortable: true },
  { key: 'eta', label: 'ETA', sortable: true },
  { key: 'status', label: 'Status', sortable: true, always: true },
];

export const MODES = ['Ocean', 'Air', 'Road'];
export const STATUSES = Object.keys(STATUS_TONE);

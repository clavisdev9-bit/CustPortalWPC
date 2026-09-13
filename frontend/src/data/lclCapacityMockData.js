// Mock dataset for the LCL Capacity prototype, added under the "Portal WPC" nav group requested
// alongside Shipment Tracking and Vessel Schedule. Same situation as those two (see
// vesselScheduleMockData.js header): no Odoo/backend model backs LCL consolidation capacity yet,
// so this is in-memory sample data only and every page built on it says so.

import { PORTS } from './vesselScheduleMockData';

function port(code) {
  return PORTS.find((p) => p.code === code);
}

// status is derived from available_cbm vs total_cbm, not stored -- keeps the two numbers as the
// single source of truth instead of risking them drifting out of sync with a hand-set label.
export const LCL_STATE_LABEL = {
  open: 'Open',
  near_full: 'Limited Space',
  full: 'Full',
};

export const LCL_STATE_TONE = {
  open: 'success',
  near_full: 'warning',
  full: 'danger',
};

function deriveState(availableCbm, totalCbm) {
  if (availableCbm <= 0) return 'full';
  if (availableCbm / totalCbm <= 0.25) return 'near_full';
  return 'open';
}

export const SAILINGS = [
  {
    id: 4101, sailing_code: 'LCL-JKTSIN-037', pol: 'IDJKT', pod: 'SGSIN', cfs: 'CFS-01',
    etd: '2026-09-18T00:00:00Z', eta: '2026-09-22T00:00:00Z', si_cutoff: '2026-09-15T17:00:00Z',
    total_cbm: 20, booked_cbm: 12,
  },
  {
    id: 4102, sailing_code: 'LCL-JKTSIN-038', pol: 'IDJKT', pod: 'SGSIN', cfs: 'CFS-02',
    etd: '2026-09-22T00:00:00Z', eta: '2026-09-26T00:00:00Z', si_cutoff: '2026-09-19T17:00:00Z',
    total_cbm: 20, booked_cbm: 6,
  },
  {
    id: 4103, sailing_code: 'LCL-JKTSIN-039', pol: 'IDJKT', pod: 'SGSIN', cfs: 'CFS-03',
    etd: '2026-09-25T00:00:00Z', eta: '2026-09-30T00:00:00Z', si_cutoff: '2026-09-22T17:00:00Z',
    total_cbm: 20, booked_cbm: 17,
  },
  {
    id: 4104, sailing_code: 'LCL-JKTBKK-014', pol: 'IDJKT', pod: 'MYPKG', cfs: 'CFS-01',
    etd: '2026-09-20T00:00:00Z', eta: '2026-09-24T00:00:00Z', si_cutoff: '2026-09-17T17:00:00Z',
    total_cbm: 18, booked_cbm: 12,
  },
  {
    id: 4105, sailing_code: 'LCL-SUBSIN-021', pol: 'IDSUB', pod: 'SGSIN', cfs: 'CFS-02',
    etd: '2026-09-19T00:00:00Z', eta: '2026-09-23T00:00:00Z', si_cutoff: '2026-09-16T17:00:00Z',
    total_cbm: 15, booked_cbm: 15,
  },
  {
    id: 4106, sailing_code: 'LCL-JKTSIN-040', pol: 'IDJKT', pod: 'SGSIN', cfs: 'CFS-01',
    etd: '2026-09-29T00:00:00Z', eta: '2026-10-03T00:00:00Z', si_cutoff: '2026-09-26T17:00:00Z',
    total_cbm: 20, booked_cbm: 3,
  },
].map((s) => {
  const available_cbm = s.total_cbm - s.booked_cbm;
  return { ...s, pol: port(s.pol), pod: port(s.pod), available_cbm, state: deriveState(available_cbm, s.total_cbm) };
});

export const LCL_STATES = Object.keys(LCL_STATE_LABEL);

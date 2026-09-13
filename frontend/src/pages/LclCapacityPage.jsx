import { useMemo, useState } from 'react';
import EmptyState from '../components/EmptyState';
import LclCapacityStatusBadge from '../components/LclCapacityStatusBadge';
import { PORTS } from '../data/vesselScheduleMockData';
import { SAILINGS } from '../data/lclCapacityMockData';
import { formatPortTime } from '../utils/portTime';

// "Portal WPC" nav group prototype -- same footing as Shipment Tracking and Vessel Schedule
// (see vesselScheduleMockData.js header): in-memory sample sailings only, no `src/api` module, no
// Odoo model behind it. "Request Booking" below never calls a backend -- it only records a local,
// non-persistent acknowledgement so the flow from the blueprint (search → check cargo volume →
// request booking) is visible without pretending a real booking was submitted.

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-3.5-3.5" />
    </svg>
  );
}

export default function LclCapacityPage() {
  const [polFilter, setPolFilter] = useState('');
  const [podFilter, setPodFilter] = useState('');
  const [cargoCbm, setCargoCbm] = useState('');
  const [requested, setRequested] = useState({});

  const filtered = useMemo(() => {
    let rows = SAILINGS;
    if (polFilter) rows = rows.filter((s) => s.pol.code === polFilter);
    if (podFilter) rows = rows.filter((s) => s.pod.code === podFilter);
    return [...rows].sort((a, b) => a.etd.localeCompare(b.etd));
  }, [polFilter, podFilter]);

  const totals = useMemo(() => ({
    lanes: filtered.length,
    availableCbm: filtered.reduce((sum, s) => sum + Math.max(s.available_cbm, 0), 0),
  }), [filtered]);

  const cargoRequested = Number(cargoCbm) > 0 ? Number(cargoCbm) : null;

  function clearFilters() {
    setPolFilter('');
    setPodFilter('');
  }

  return (
    <div className="lcl-capacity-page">
      <div className="page-head">
        <h1>LCL Capacity</h1>
        <span className="pill pill--warning">Sample data — not yet connected to Odoo</span>
      </div>
      <p className="muted">
        Preview of available LCL consolidation space per sailing. Enter your cargo volume to see
        which sailings can take it; "Request Booking" only records a local acknowledgement here,
        it does not submit a real booking yet.
      </p>

      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi__value">{totals.lanes}</div>
          <div className="kpi__label">Sailings Shown</div>
        </div>
        <div className="kpi">
          <div className="kpi__value">{totals.availableCbm} CBM</div>
          <div className="kpi__label">Total Available</div>
        </div>
      </div>

      <div className="card lcl-table-card">
        <div className="vessel-toolbar">
          <div className="vessel-toolbar__left">
            <select aria-label="Filter by port of loading" value={polFilter} onChange={(e) => setPolFilter(e.target.value)}>
              <option value="">All Ports (POL)</option>
              {PORTS.map((p) => <option key={p.id} value={p.code}>{p.code} — {p.name}</option>)}
            </select>
            <select aria-label="Filter by port of discharge" value={podFilter} onChange={(e) => setPodFilter(e.target.value)}>
              <option value="">All Ports (POD)</option>
              {PORTS.map((p) => <option key={p.id} value={p.code}>{p.code} — {p.name}</option>)}
            </select>
            <label className="search-box">
              <SearchIcon />
              <input
                type="number"
                min="0"
                step="0.1"
                placeholder="Cargo volume (CBM)"
                aria-label="Cargo volume in CBM"
                value={cargoCbm}
                onChange={(e) => setCargoCbm(e.target.value)}
              />
            </label>
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            title="No sailings match your filters"
            hint="Try a different route."
            action={<button type="button" className="btn-primary" onClick={clearFilters}>Clear filters</button>}
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Sailing</th>
                  <th>Route</th>
                  <th>CFS</th>
                  <th>ETD</th>
                  <th>ETA</th>
                  <th>SI Cut-off</th>
                  <th>Total CBM</th>
                  <th>Available</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const fits = cargoRequested != null && s.available_cbm >= cargoRequested;
                  const already = requested[s.id];
                  return (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 600 }}>{s.sailing_code}</td>
                      <td className="mono">{s.pol.code} → {s.pod.code}</td>
                      <td>{s.cfs}</td>
                      <td className="mono">{formatPortTime(s.etd, s.pol.tz)}</td>
                      <td className="mono">{formatPortTime(s.eta, s.pod.tz)}</td>
                      <td className="mono">{formatPortTime(s.si_cutoff, s.pol.tz)}</td>
                      <td className="mono">{s.total_cbm} CBM</td>
                      <td className="mono" style={{ fontWeight: 600 }}>{s.available_cbm} CBM</td>
                      <td><LclCapacityStatusBadge state={s.state} /></td>
                      <td>
                        {already ? (
                          <span className="pill pill--success">Request noted</span>
                        ) : (
                          <button
                            type="button"
                            className="btn-secondary"
                            disabled={cargoRequested == null || !fits}
                            title={cargoRequested == null ? 'Enter a cargo volume first' : !fits ? 'Not enough space on this sailing' : ''}
                            onClick={() => setRequested((r) => ({ ...r, [s.id]: true }))}
                          >
                            Request Booking
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

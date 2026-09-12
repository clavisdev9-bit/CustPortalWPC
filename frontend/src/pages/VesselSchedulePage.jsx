import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import EmptyState from '../components/EmptyState';
import VesselStatusBadge from '../components/VesselStatusBadge';
import { PORTS, STATE_LABEL, STATES, VOYAGES } from '../data/vesselScheduleMockData';
import { formatPortTime, formatUpdatedAt } from '../utils/portTime';

// Fase 0-P prototype (Docs/CR/customer_portal_vessel_schedule.md §17): mockup §A over the in-memory
// VOYAGES mock. No `src/api` module exists yet -- the data this would read (`freight.voyage`) lives
// in an Odoo addon that hasn't been built (CR §1 Temuan 1), so this page is UI-only and says so.
// D-2's "boleh dilihat semua pemegang akun" premise is why there's no partner/company filtering
// here at all, even as a mock -- everyone who opens this page sees the same rows.

const PAGE_SIZE = 5;

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-3.5-3.5" />
    </svg>
  );
}

export default function VesselSchedulePage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [polFilter, setPolFilter] = useState('');
  const [podFilter, setPodFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  const counts = useMemo(() => {
    const c = {};
    for (const s of STATES) c[s] = VOYAGES.filter((v) => v.state === s).length;
    return c;
  }, []);

  const filtered = useMemo(() => {
    let rows = VOYAGES;
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((v) => v.voyage_no.toLowerCase().includes(q)
        || v.vessel.name.toLowerCase().includes(q)
        || v.vessel.imo_number.includes(q));
    }
    if (polFilter) rows = rows.filter((v) => v.pol.code === polFilter);
    if (podFilter) rows = rows.filter((v) => v.pod.code === podFilter);
    if (stateFilter) rows = rows.filter((v) => v.state === stateFilter);
    if (dateFrom) rows = rows.filter((v) => v.etd.slice(0, 10) >= dateFrom);
    if (dateTo) rows = rows.filter((v) => v.etd.slice(0, 10) <= dateTo);
    return [...rows].sort((a, b) => a.etd.localeCompare(b.etd));
  }, [search, polFilter, podFilter, stateFilter, dateFrom, dateTo]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function clearAllFilters() {
    setSearch('');
    setPolFilter('');
    setPodFilter('');
    setStateFilter('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  }

  return (
    <div className="vessel-schedule-page">
      <div className="page-head">
        <h1>Vessel Schedule</h1>
        <span className="pill pill--warning">Sample data — not yet connected to Odoo</span>
      </div>
      <p className="muted">
        This preview uses fixed sample sailings while the vessel/voyage data source is being built
        in Odoo (see CR §1). Nothing on this page reflects a real schedule yet.
      </p>

      <div className="kpi-grid kpi-grid--5">
        <button type="button" className={`kpi${stateFilter === '' ? ' is-selected' : ''}`} onClick={() => { setStateFilter(''); setPage(1); }}>
          <div className="kpi__top"><span className="status-dot status-dot--primary" aria-hidden="true" /></div>
          <div className="kpi__value">{VOYAGES.length}</div>
          <div className="kpi__label">All Voyages</div>
        </button>
        {STATES.map((s) => (
          <button
            key={s}
            type="button"
            className={`kpi${stateFilter === s ? ' is-selected' : ''}`}
            onClick={() => { setStateFilter(s); setPage(1); }}
          >
            <div className="kpi__top">
              <span className={`status-dot status-dot--${s === 'scheduled' ? 'info' : s === 'departed' ? 'warning' : s === 'arrived' ? 'success' : s === 'delayed' ? 'danger' : 'neutral'}`} aria-hidden="true" />
            </div>
            <div className="kpi__value">{counts[s]}</div>
            <div className="kpi__label">{STATE_LABEL[s]}</div>
          </button>
        ))}
      </div>

      <div className="card vessel-table-card">
        <div className="vessel-toolbar">
          <div className="vessel-toolbar__left">
            <div className="search-box">
              <SearchIcon />
              <input
                placeholder="Vessel name / voyage no / IMO…"
                aria-label="Search vessel, voyage number, or IMO"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            <select aria-label="Filter by port of loading" value={polFilter} onChange={(e) => { setPolFilter(e.target.value); setPage(1); }}>
              <option value="">All Ports (POL)</option>
              {PORTS.map((p) => <option key={p.id} value={p.code}>{p.code} — {p.name}</option>)}
            </select>
            <select aria-label="Filter by port of discharge" value={podFilter} onChange={(e) => { setPodFilter(e.target.value); setPage(1); }}>
              <option value="">All Ports (POD)</option>
              {PORTS.map((p) => <option key={p.id} value={p.code}>{p.code} — {p.name}</option>)}
            </select>
            <label className="vessel-search-field" style={{ flex: '0 0 auto' }}>
              <input type="date" aria-label="ETD from" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
            </label>
            <label className="vessel-search-field" style={{ flex: '0 0 auto' }}>
              <input type="date" aria-label="ETD to" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
            </label>
          </div>
        </div>

        {pageRows.length === 0 ? (
          <EmptyState
            title="No voyages match your filters"
            hint="Try adjusting the search terms or clearing active filters."
            action={<button type="button" className="btn-primary" onClick={clearAllFilters}>Clear filters</button>}
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Voyage No.</th>
                  <th>Vessel</th>
                  <th>Service</th>
                  <th>Route</th>
                  <th>ETD</th>
                  <th>ETA</th>
                  <th>Status</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((v) => (
                  <tr
                    key={v.id}
                    className="vessel-row"
                    tabIndex={0}
                    onClick={() => navigate(`/vessel-schedule/${v.id}`)}
                    onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/vessel-schedule/${v.id}`); }}
                  >
                    <td style={{ fontWeight: 600 }}>{v.voyage_no}</td>
                    <td>{v.vessel.name}</td>
                    <td style={{ textTransform: 'capitalize' }}>{v.service_type}</td>
                    <td className="mono">{v.pol.code} → {v.pod.code}</td>
                    <td className="mono">{formatPortTime(v.etd, v.pol.tz)}</td>
                    <td className="mono">{formatPortTime(v.eta, v.pod.tz)}</td>
                    <td><VesselStatusBadge state={v.state} /></td>
                    <td className="muted">{formatUpdatedAt(v.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="vessel-table-footer">
          <span className="muted">
            Showing {filtered.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1}
            –{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length} voyages
          </span>
          <div className="pagination">
            <button type="button" className="vessel-icon-btn" disabled={currentPage === 1} onClick={() => setPage(1)} aria-label="First page">«</button>
            <button type="button" className="vessel-icon-btn" disabled={currentPage === 1} onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label="Previous page">‹</button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                type="button"
                className={`vessel-icon-btn${p === currentPage ? ' is-current' : ''}`}
                onClick={() => setPage(p)}
                aria-current={p === currentPage ? 'page' : undefined}
              >
                {p}
              </button>
            ))}
            <button type="button" className="vessel-icon-btn" disabled={currentPage === totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} aria-label="Next page">›</button>
            <button type="button" className="vessel-icon-btn" disabled={currentPage === totalPages} onClick={() => setPage(totalPages)} aria-label="Last page">»</button>
          </div>
        </div>
      </div>
    </div>
  );
}

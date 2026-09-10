import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import ToastStack, { useToasts } from '../components/Toast';
import EmptyState from '../components/EmptyState';
import TableSkeleton from '../components/TableSkeleton';
import ShipmentStatusBadge from '../components/ShipmentStatusBadge';
import { ALL_COLUMNS, MODES, SHIPMENTS, STATUSES } from '../data/shipmentMockData';
import { formatShipmentDate } from '../utils/shipmentFormat';

// Docs/CR/prompt-shipment-tracking-interactive-prototype_1.md. Pure client-side prototype over the
// in-memory SHIPMENTS mock (CR non-goal: "no real backend/API integration") -- everything here is
// local component state, nothing touches src/api or Odoo.

const PAGE_SIZE = 5;
const EMPTY_ADVANCED = { origin: '', destination: '', dateFrom: '', dateTo: '' };

const KPI_DEFS = [
  { key: '', label: 'Total Shipments', tone: 'primary' },
  { key: 'In Transit', label: 'In Transit', tone: 'info' },
  { key: 'Arriving Soon', label: 'Arriving Soon', tone: 'warning' },
  { key: 'Delivered', label: 'Delivered', tone: 'success' },
  { key: 'Delayed', label: 'Delayed', tone: 'danger' },
];

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-3.5-3.5" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function renderCell(col, row) {
  if (col.key === 'status') return <ShipmentStatusBadge status={row.status} />;
  if (col.key === 'etd' || col.key === 'eta') return <span className="mono">{formatShipmentDate(row[col.key])}</span>;
  if (col.key === 'container' || col.key === 'bl' || col.key === 'booking') {
    return row[col.key] === '—' ? <span className="muted">Not applicable</span> : <span className="mono">{row[col.key]}</span>;
  }
  if (col.key === 'id') return <span className="mono" style={{ fontWeight: 600 }}>{row.id}</span>;
  return row[col.key];
}

export default function ShipmentTrackingPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const restored = location.state?.listState;
  const { toasts, push, dismiss } = useToasts();

  const [search, setSearch] = useState(restored?.search ?? '');
  const [panelDraft, setPanelDraft] = useState(restored?.search ?? '');
  const [toolbarDraft, setToolbarDraft] = useState(restored?.search ?? '');
  const [statusFilter, setStatusFilter] = useState(restored?.statusFilter ?? '');
  const [modeFilter, setModeFilter] = useState(restored?.modeFilter ?? '');
  const [advanced, setAdvanced] = useState(restored?.advanced ?? EMPTY_ADVANCED);
  const [sortKey, setSortKey] = useState(restored?.sortKey ?? 'id');
  const [sortDir, setSortDir] = useState(restored?.sortDir ?? 'asc');
  const [page, setPage] = useState(restored?.page ?? 1);
  const [hiddenColumns, setHiddenColumns] = useState(() => new Set());
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerDraft, setDrawerDraft] = useState({ mode: '', status: '', ...EMPTY_ADVANCED });
  const [columnsOpen, setColumnsOpen] = useState(false);

  const loadingTimer = useRef(null);
  const toolbarTimer = useRef(null);
  const columnsRef = useRef(null);

  // Keeps the panel search box and the toolbar's live search box showing the same value, whichever
  // one last committed a change -- mirrors the single shared `quickSearch` field in the reference.
  useEffect(() => {
    setPanelDraft(search);
    setToolbarDraft(search);
  }, [search]);

  useEffect(() => () => {
    if (loadingTimer.current) clearTimeout(loadingTimer.current);
    if (toolbarTimer.current) clearTimeout(toolbarTimer.current);
  }, []);

  useEffect(() => {
    if (!columnsOpen) return undefined;
    function handleClick(e) {
      if (columnsRef.current && !columnsRef.current.contains(e.target)) setColumnsOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [columnsOpen]);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') {
        setDrawerOpen(false);
        setColumnsOpen(false);
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  function triggerLoading() {
    setLoading(true);
    if (loadingTimer.current) clearTimeout(loadingTimer.current);
    loadingTimer.current = setTimeout(() => setLoading(false), 420);
  }

  function commitPanelSearch() {
    setSearch(panelDraft);
    setPage(1);
    triggerLoading();
  }

  function handlePanelKeyDown(e) {
    if (e.key === 'Enter') commitPanelSearch();
  }

  function handleToolbarChange(e) {
    const value = e.target.value;
    setToolbarDraft(value);
    if (toolbarTimer.current) clearTimeout(toolbarTimer.current);
    toolbarTimer.current = setTimeout(() => {
      setSearch(value);
      setPage(1);
    }, 300);
  }

  function handleKpiClick(statusKey) {
    setStatusFilter(statusKey);
    setPage(1);
    triggerLoading();
  }

  function handleModeSelect(value) {
    setModeFilter(value);
    setPage(1);
    triggerLoading();
  }

  function handleStatusSelect(value) {
    setStatusFilter(value);
    setPage(1);
    triggerLoading();
  }

  function openDrawer() {
    setDrawerDraft({
      mode: modeFilter,
      status: statusFilter,
      origin: advanced.origin,
      destination: advanced.destination,
      dateFrom: advanced.dateFrom,
      dateTo: advanced.dateTo,
    });
    setDrawerOpen(true);
  }

  function applyDrawer() {
    setModeFilter(drawerDraft.mode);
    setStatusFilter(drawerDraft.status);
    setAdvanced({
      origin: drawerDraft.origin,
      destination: drawerDraft.destination,
      dateFrom: drawerDraft.dateFrom,
      dateTo: drawerDraft.dateTo,
    });
    setPage(1);
    setDrawerOpen(false);
    triggerLoading();
  }

  function resetDrawer() {
    setModeFilter('');
    setStatusFilter('');
    setAdvanced(EMPTY_ADVANCED);
    setDrawerDraft({ mode: '', status: '', ...EMPTY_ADVANCED });
    setPage(1);
    setDrawerOpen(false);
    triggerLoading();
  }

  function toggleColumn(key) {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleExport() {
    push({ title: `Exporting ${filteredSorted.length} shipments to Excel…`, tone: 'success' });
  }

  function handleSort(key) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  function clearAllFilters() {
    setSearch('');
    setStatusFilter('');
    setModeFilter('');
    setAdvanced(EMPTY_ADVANCED);
    setPage(1);
    triggerLoading();
  }

  function removeChip(key) {
    if (key === 'status') setStatusFilter('');
    else if (key === 'mode') setModeFilter('');
    else if (key === 'origin') setAdvanced((a) => ({ ...a, origin: '' }));
    else if (key === 'destination') setAdvanced((a) => ({ ...a, destination: '' }));
    else if (key === 'dateFrom') setAdvanced((a) => ({ ...a, dateFrom: '' }));
    else if (key === 'dateTo') setAdvanced((a) => ({ ...a, dateTo: '' }));
    else if (key === 'search') setSearch('');
    setPage(1);
    triggerLoading();
  }

  const counts = useMemo(() => ({
    '': SHIPMENTS.length,
    'In Transit': SHIPMENTS.filter((r) => r.status === 'In Transit').length,
    'Arriving Soon': SHIPMENTS.filter((r) => r.status === 'Arriving Soon').length,
    Delivered: SHIPMENTS.filter((r) => r.status === 'Delivered').length,
    Delayed: SHIPMENTS.filter((r) => r.status === 'Delayed').length,
  }), []);

  const filteredSorted = useMemo(() => {
    let rows = SHIPMENTS;
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) => r.id.toLowerCase().includes(q)
        || (r.container || '').toLowerCase().includes(q)
        || (r.bl || '').toLowerCase().includes(q)
        || (r.booking || '').toLowerCase().includes(q));
    }
    if (statusFilter) rows = rows.filter((r) => r.status === statusFilter);
    if (modeFilter) rows = rows.filter((r) => r.mode === modeFilter);
    if (advanced.origin.trim()) {
      const oq = advanced.origin.trim().toLowerCase();
      rows = rows.filter((r) => r.origin.toLowerCase().includes(oq));
    }
    if (advanced.destination.trim()) {
      const dq = advanced.destination.trim().toLowerCase();
      rows = rows.filter((r) => r.destination.toLowerCase().includes(dq));
    }
    if (advanced.dateFrom) rows = rows.filter((r) => r.etd >= advanced.dateFrom);
    if (advanced.dateTo) rows = rows.filter((r) => r.etd <= advanced.dateTo);

    return [...rows].sort((a, b) => {
      const av = String(a[sortKey] ?? '').toLowerCase();
      const bv = String(b[sortKey] ?? '').toLowerCase();
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [search, statusFilter, modeFilter, advanced, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredSorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filteredSorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const visibleColumns = ALL_COLUMNS.filter((c) => c.always || !hiddenColumns.has(c.key));

  const chips = useMemo(() => {
    const list = [];
    if (statusFilter) list.push({ key: 'status', label: `Status: ${statusFilter}` });
    if (modeFilter) list.push({ key: 'mode', label: `Mode: ${modeFilter}` });
    if (advanced.origin) list.push({ key: 'origin', label: `Origin: ${advanced.origin}` });
    if (advanced.destination) list.push({ key: 'destination', label: `Destination: ${advanced.destination}` });
    if (advanced.dateFrom) list.push({ key: 'dateFrom', label: `ETD from ${advanced.dateFrom}` });
    if (advanced.dateTo) list.push({ key: 'dateTo', label: `ETD to ${advanced.dateTo}` });
    if (search) list.push({ key: 'search', label: `Search: "${search}"` });
    return list;
  }, [statusFilter, modeFilter, advanced, search]);

  function goToDetail(id) {
    navigate(`/shipment-tracking/${id}`, {
      state: { listState: { search, statusFilter, modeFilter, advanced, sortKey, sortDir, page: currentPage } },
    });
  }

  return (
    <div className="shipment-tracking-page">
      <div className="page-head">
        <h1>Shipment Tracking</h1>
      </div>

      <div className="kpis">
        <div className="kpi-grid kpi-grid--5">
          {KPI_DEFS.map((kpi) => (
            <button
              key={kpi.key || 'total'}
              type="button"
              className={`kpi${statusFilter === kpi.key ? ' is-selected' : ''}`}
              onClick={() => handleKpiClick(kpi.key)}
            >
              <div className="kpi__top">
                <span className={`status-dot status-dot--${kpi.tone}`} aria-hidden="true" />
              </div>
              <div className="kpi__value">{counts[kpi.key]}</div>
              <div className="kpi__label">{kpi.label}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="shipment-search-row">
          <label className="shipment-search-field">
            Shipment ID / Container / B-L / Booking
            <input
              placeholder="e.g. SHP-2026-04831"
              value={panelDraft}
              onChange={(e) => setPanelDraft(e.target.value)}
              onKeyDown={handlePanelKeyDown}
            />
          </label>
          <div className="button-row">
            <button type="button" className="btn-primary" onClick={commitPanelSearch}>Search</button>
            <button type="button" className="btn-secondary" onClick={openDrawer}>Advanced filter</button>
          </div>
        </div>
        {chips.length > 0 && (
          <div className="chip-row">
            {chips.map((c) => (
              <span className="chip" key={c.key}>
                {c.label}
                <button type="button" aria-label={`Remove filter: ${c.label}`} onClick={() => removeChip(c.key)}>×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="card shipment-table-card">
        <div className="shipment-toolbar">
          <div className="shipment-toolbar__left">
            <div className="search-box">
              <SearchIcon />
              <input
                placeholder="Filter visible rows…"
                aria-label="Filter visible rows"
                value={toolbarDraft}
                onChange={handleToolbarChange}
              />
            </div>
            <select aria-label="Filter by mode" value={modeFilter} onChange={(e) => handleModeSelect(e.target.value)}>
              <option value="">All modes</option>
              {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <select aria-label="Filter by status" value={statusFilter} onChange={(e) => handleStatusSelect(e.target.value)}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="shipment-toolbar__right" ref={columnsRef}>
            <div className="popover-wrap">
              <button type="button" className="btn-secondary" onClick={() => setColumnsOpen((o) => !o)}>Customize columns</button>
              {columnsOpen && (
                <div className="popover">
                  {ALL_COLUMNS.filter((c) => !c.always).map((c) => (
                    <label key={c.key} className="checkbox-label popover__option">
                      <input type="checkbox" checked={!hiddenColumns.has(c.key)} onChange={() => toggleColumn(c.key)} />
                      {c.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <button type="button" className="btn-secondary" onClick={handleExport}>Export</button>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 'var(--s-4) var(--s-5)' }}>
            <TableSkeleton rows={5} cols={visibleColumns.length + 1} />
          </div>
        ) : pageRows.length === 0 ? (
          <EmptyState
            title="No shipments match your filters"
            hint="Try adjusting your search terms or clearing active filters."
            action={<button type="button" className="btn-primary" onClick={clearAllFilters}>Clear filters</button>}
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {visibleColumns.map((c) => (
                    <th key={c.key} className={sortKey === c.key ? 'is-sorted' : ''}>
                      {c.sortable ? (
                        <button type="button" className="th-sort-btn" onClick={() => handleSort(c.key)}>
                          {c.label}
                          <span className="sort-arrow" aria-hidden="true">
                            {sortKey === c.key ? (sortDir === 'asc' ? '▲' : '▼') : '▲'}
                          </span>
                        </button>
                      ) : c.label}
                    </th>
                  ))}
                  <th aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr
                    key={r.id}
                    className="shipment-row"
                    tabIndex={0}
                    onClick={() => goToDetail(r.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') goToDetail(r.id); }}
                  >
                    {visibleColumns.map((c) => <td key={c.key}>{renderCell(c, r)}</td>)}
                    <td>
                      <button
                        type="button"
                        className="shipment-icon-btn"
                        aria-label={`View ${r.id}`}
                        title="View detail"
                        onClick={(e) => { e.stopPropagation(); goToDetail(r.id); }}
                      >
                        <EyeIcon />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="shipment-table-footer">
          <span className="muted">
            Showing {filteredSorted.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1}
            –{Math.min(currentPage * PAGE_SIZE, filteredSorted.length)} of {filteredSorted.length} shipments
          </span>
          <div className="pagination">
            <button type="button" className="shipment-icon-btn" disabled={currentPage === 1} onClick={() => setPage(1)} aria-label="First page">«</button>
            <button type="button" className="shipment-icon-btn" disabled={currentPage === 1} onClick={() => setPage(Math.max(1, currentPage - 1))} aria-label="Previous page">‹</button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                type="button"
                className={`shipment-icon-btn${p === currentPage ? ' is-current' : ''}`}
                onClick={() => setPage(p)}
                aria-current={p === currentPage ? 'page' : undefined}
              >
                {p}
              </button>
            ))}
            <button type="button" className="shipment-icon-btn" disabled={currentPage === totalPages} onClick={() => setPage(Math.min(totalPages, currentPage + 1))} aria-label="Next page">›</button>
            <button type="button" className="shipment-icon-btn" disabled={currentPage === totalPages} onClick={() => setPage(totalPages)} aria-label="Last page">»</button>
          </div>
        </div>
      </div>

      <div className={`drawer-overlay${drawerOpen ? ' is-open' : ''}`} onClick={() => setDrawerOpen(false)} aria-hidden={!drawerOpen} />
      {/* `inert` (not aria-hidden) while closed: the drawer stays mounted off-screen for the slide
          transition, and aria-hidden on a container with focusable fields inside would leave them
          reachable by Tab while hidden from assistive tech -- a real WCAG conflict. */}
      <div
        className={`shipment-drawer${drawerOpen ? ' is-open' : ''}`}
        role="dialog"
        aria-label="Advanced filter"
        inert={drawerOpen ? undefined : ''}
      >
        <h3>Advanced filter</h3>
        <label>
          Mode
          <select value={drawerDraft.mode} onChange={(e) => setDrawerDraft((d) => ({ ...d, mode: e.target.value }))}>
            <option value="">Any mode</option>
            {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label>
          Status
          <select value={drawerDraft.status} onChange={(e) => setDrawerDraft((d) => ({ ...d, status: e.target.value }))}>
            <option value="">Any status</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>
          Origin
          <input placeholder="e.g. Shanghai" value={drawerDraft.origin} onChange={(e) => setDrawerDraft((d) => ({ ...d, origin: e.target.value }))} />
        </label>
        <label>
          Destination
          <input placeholder="e.g. Rotterdam" value={drawerDraft.destination} onChange={(e) => setDrawerDraft((d) => ({ ...d, destination: e.target.value }))} />
        </label>
        <label>
          ETD from
          <input type="date" value={drawerDraft.dateFrom} onChange={(e) => setDrawerDraft((d) => ({ ...d, dateFrom: e.target.value }))} />
        </label>
        <label>
          ETD to
          <input type="date" value={drawerDraft.dateTo} onChange={(e) => setDrawerDraft((d) => ({ ...d, dateTo: e.target.value }))} />
        </label>
        <div className="shipment-drawer__actions">
          <button type="button" className="btn-secondary" style={{ flex: 1 }} onClick={resetDrawer}>Reset</button>
          <button type="button" className="btn-primary" style={{ flex: 1 }} onClick={applyDrawer}>Apply filters</button>
        </div>
      </div>

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

# Portal WPC — Panduan Implementasi (Freight Forwarding Menu)

> File ini adalah panduan implementasi mandiri untuk fitur menu **"Portal WPC"** yang sudah
> dikerjakan di branch `claude/hopeful-brown-qq1nxc`, tapi belum bisa di-push ke GitHub karena
> akses GitHub App untuk repo `clavisdev9-bit/CustPortalWPC` belum terpasang di sesi ini. Dokumen
> ini berisi semua yang dibutuhkan untuk menerapkan perubahan yang sama secara manual di VSCode,
> tanpa bergantung pada commit yang tertahan di sesi tersebut.

## 1. Ringkasan

Menambahkan grup menu sidebar baru **"Portal WPC"** berisi 3 submenu, mengikuti diagram arsitektur
di attachment (`cust_portal.md` §6): *Shipment Data (Sea/Air)*, *Vessel/Flight schedule*,
*Capacity/LCL*.

| Submenu | Route | Status |
|---|---|---|
| Shipment Tracking | `/shipment-tracking` | Sudah ada di codebase (mock, dipakai ulang) |
| Vessel Schedule | `/vessel-schedule` | Sudah ada di codebase (mock, dipakai ulang) |
| LCL Capacity | `/lcl-capacity` | **Baru** — halaman mock, dibuat mengikuti pola 2 halaman di atas |

**Catatan penting:**

- Ketiganya murni **UI mock berbasis data in-memory** (`frontend/src/data/*MockData.js`) —
  **tidak ada** endpoint backend/`src/api` baru, **tidak ada** perubahan ke Odoo atau
  `database/migrations`. Konsisten dengan pola yang sudah dipakai `ShipmentTrackingPage.jsx` dan
  `VesselSchedulePage.jsx` (lihat komentar header masing-masing file): keduanya sengaja belum
  tersambung ke Odoo karena addon `freight_schedule` belum ada.
- Menu **"Delivery"** dan seluruh menu lain **tidak disentuh sama sekali** — "Shipment Tracking"
  dan "Vessel Schedule" tetap bisa diakses dari sana juga (link duplikat ke route yang sama,
  bukan dipindah).
- Tidak ada perubahan `api/openapi.yaml` (tidak ada endpoint baru) dan tidak ada perubahan
  `frontend/src/styles/index.css` (semua styling pakai class yang sudah ada: `.card`, `.kpi-grid`,
  `.pill`, `.table-wrap`, dst.), jadi `node scripts/check-css-vendor-prefixes.js` tidak perlu
  dijalankan untuk perubahan ini.

## 2. Cara menerapkan di VSCode

### Opsi A — lewat git (paling mudah, kalau akses GitHub App sudah diaktifkan)

Setelah admin org memasang Claude GitHub App
(https://github.com/apps/claude/installations/select_target) atau GitHub di-reconnect lewat
claude.ai, branch `claude/hopeful-brown-qq1nxc` akan bisa di-push dari sesi tersebut. Setelah itu,
di VSCode tinggal:

```bash
git fetch origin claude/hopeful-brown-qq1nxc
git checkout claude/hopeful-brown-qq1nxc
# atau, kalau mau merge ke branch kerja Anda sendiri:
git merge origin/claude/hopeful-brown-qq1nxc
```

### Opsi B — manual (kalau branch itu belum ter-push)

Terapkan perubahan di §3 (dua file yang di-edit) dan §4 (tiga file baru) satu per satu di VSCode,
lalu jalankan verifikasi di §5.

## 3. File yang diedit

### `frontend/src/App.jsx`

Tambahkan import (setelah baris `VesselScheduleDetailPage`):

```js
import LclCapacityPage from './pages/LclCapacityPage';
```

Tambahkan route baru (setelah route `vessel-schedule/:id`, sebelum `requests`):

```jsx
{/* Portal WPC group (freight-forwarding blueprint attachment): clickable prototype over an
    in-memory mock, no backend involved -- see LclCapacityPage.jsx header. */}
<Route path="lcl-capacity" element={<LclCapacityPage />} />
```

### `frontend/src/components/AppShell.jsx`

Tambahkan section nav baru di array `NAV_SECTIONS`, tepat setelah blok `Delivery` (sebelum blok
`After Sales`):

```jsx
{
  // Freight-forwarding blueprint attachment (§6 arsitektur: Shipment Data / Sea-Air, Vessel-
  // Flight schedule, Capacity/LCL). Added as its own group rather than folded into "Delivery"
  // so the existing Delivery menu stays exactly as-is; the two prototype pages below are also
  // still reachable from Delivery, this just gives them a dedicated, purpose-named home too.
  label: 'Portal WPC',
  children: [
    { label: 'Shipment Tracking', to: '/shipment-tracking' },
    { label: 'Vessel Schedule', to: '/vessel-schedule' },
    { label: 'LCL Capacity', to: '/lcl-capacity' },
  ],
},
```

Tambahkan satu entry di object `ICON_PATHS` (tepat setelah entry `'Vessel Schedule'`):

```jsx
'LCL Capacity': <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 15h11M14 15v6M3 3l11 12" /></>,
```

## 4. File baru

### `frontend/src/data/lclCapacityMockData.js`

```js
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
```

### `frontend/src/components/LclCapacityStatusBadge.jsx`

```jsx
import { LCL_STATE_LABEL, LCL_STATE_TONE } from '../data/lclCapacityMockData';

// Mirrors VesselStatusBadge: domain-specific label/tone lookup rather than the generic keyword
// based StatusBadge, since "Full" here must read as danger and "Limited Space" as warning.
export default function LclCapacityStatusBadge({ state }) {
  const tone = LCL_STATE_TONE[state] || 'neutral';
  return <span className={`pill pill--${tone}`}>{LCL_STATE_LABEL[state] || state}</span>;
}
```

### `frontend/src/pages/LclCapacityPage.jsx`

```jsx
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
```

## 5. Verifikasi setelah menerapkan

Dari root repo di VSCode:

```bash
cd frontend
npm install   # kalau belum pernah
PORT=7181 npm run build
```

Build harus sukses tanpa error. Untuk cek visual, jalankan dev server dari root repo (bukan dari
`frontend/`, sesuai `CLAUDE.md`):

```bash
npm run dev
```

Buka `http://localhost:7180`, login, lalu pastikan grup menu **"Portal WPC"** muncul di sidebar
dengan 3 submenu (Shipment Tracking, Vessel Schedule, LCL Capacity), dan menu "Delivery" masih
persis seperti sebelumnya.

## 6. Sudah tercatat di git (sesi yang membuat file ini)

Perubahan yang sama sudah ter-commit secara lokal di sesi Claude Code sebelumnya, di branch
`claude/hopeful-brown-qq1nxc`, commit `0941098` — belum ter-push karena akses GitHub App belum
terpasang untuk repo ini. File ini dibuat supaya perubahan yang sama bisa diterapkan lewat VSCode
secara independen tanpa bergantung pada commit tersebut ter-push.

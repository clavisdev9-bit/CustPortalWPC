import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import EmptyState from '../components/EmptyState';
import VesselStatusBadge from '../components/VesselStatusBadge';
import { LEG_TYPE_LABEL, VOYAGES } from '../data/vesselScheduleMockData';
import { formatPortTime, formatUpdatedAt } from '../utils/portTime';

// Fase 0-P prototype -- mockup §B (Overview / Schedule / Route). Cargo and Documents, the other two
// tabs in the mockup, are intentionally left out here: CR D-6/VS-2 require those to be
// partner-locked (booking/cargo belonging to whoever is logged in), which this in-memory mock has
// no notion of -- faking that data would misrepresent what this prototype actually shows.

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'route', label: 'Route' },
];

export default function VesselScheduleDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState('overview');
  const voyage = useMemo(() => VOYAGES.find((v) => String(v.id) === id), [id]);

  function backToList() {
    navigate('/vessel-schedule');
  }

  if (!voyage) {
    return (
      <div className="vessel-schedule-detail-page">
        <div className="breadcrumb">
          <button type="button" className="crumb-link" onClick={backToList}>Vessel Schedule</button>
        </div>
        <EmptyState title="Voyage not found" hint={`No sample voyage matches "${id}".`} />
      </div>
    );
  }

  const { vessel, pol, pod } = voyage;

  return (
    <div className="vessel-schedule-detail-page">
      <div className="breadcrumb">
        <button type="button" className="crumb-link" onClick={backToList}>Vessel Schedule</button>
        <span aria-hidden="true">/</span>
        <span>{voyage.voyage_no}</span>
      </div>
      <div className="page-head">
        <h1>{voyage.voyage_no} — {vessel.name}</h1>
        <span className="pill pill--warning">Sample data — not yet connected to Odoo</span>
      </div>

      <div className="card detail-header-card">
        <div>
          <h2>{pol.code} ({pol.name}) → {pod.code} ({pod.name})</h2>
          <VesselStatusBadge state={voyage.state} />
          <div className="info-grid">
            <div className="info-field">
              <dt>Service type</dt>
              <dd style={{ textTransform: 'capitalize' }}>{voyage.service_type}</dd>
            </div>
            <div className="info-field">
              <dt>ETD</dt>
              <dd className="mono">{formatPortTime(voyage.etd, pol.tz)}</dd>
            </div>
            <div className="info-field">
              <dt>ETA</dt>
              <dd className="mono">{formatPortTime(voyage.eta, pod.tz)}</dd>
            </div>
            <div className="info-field">
              <dt>Updated</dt>
              <dd>{formatUpdatedAt(voyage.updated_at)}</dd>
            </div>
          </div>
          {voyage.remarks && (
            <p className="muted" style={{ marginTop: 'var(--s-4)' }}>{voyage.remarks}</p>
          )}
        </div>
      </div>

      <div className="card">
        <div className="tab-strip" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`tab-btn${tab === t.key ? ' is-active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <div>
            <h3>Vessel Information</h3>
            <div className="info-grid">
              <div className="info-field"><dt>Vessel name</dt><dd>{vessel.name}</dd></div>
              <div className="info-field"><dt>IMO number</dt><dd className="mono">{vessel.imo_number}</dd></div>
              <div className="info-field"><dt>Type</dt><dd>{vessel.vessel_type}</dd></div>
              <div className="info-field"><dt>Capacity</dt><dd>{vessel.capacity_teu.toLocaleString()} TEU</dd></div>
              <div className="info-field"><dt>Flag</dt><dd>{vessel.flag}</dd></div>
              <div className="info-field"><dt>Operator</dt><dd>{vessel.operator}</dd></div>
            </div>
          </div>
        )}

        {tab === 'schedule' && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Estimated</th>
                  <th>Actual</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Departure — {pol.code}</td>
                  <td className="mono">{formatPortTime(voyage.etd, pol.tz)}</td>
                  <td className="mono">{voyage.atd ? formatPortTime(voyage.atd, pol.tz) : <span className="muted">Not yet departed</span>}</td>
                </tr>
                <tr>
                  <td>Arrival — {pod.code}</td>
                  <td className="mono">{formatPortTime(voyage.eta, pod.tz)}</td>
                  <td className="mono">{voyage.ata ? formatPortTime(voyage.ata, pod.tz) : <span className="muted">Not yet arrived</span>}</td>
                </tr>
              </tbody>
            </table>
            <p className="muted" style={{ marginTop: 'var(--s-4)' }}>
              ETD/ETA are estimates and can change — last updated {formatUpdatedAt(voyage.updated_at)}.
            </p>
          </div>
        )}

        {tab === 'route' && (
          <ul className="timeline">
            {voyage.legs.map((leg, i) => (
              <li key={i} className={`timeline__item timeline__item--${leg.ata || leg.atd ? 'done' : 'pending'}`}>
                <span className="timeline__node" aria-hidden="true" />
                {/* Not a <button> here (nothing to expand, unlike ShipmentDetailPage's timeline) --
                    `.timeline__row`'s flex layout is scoped to `button.timeline__row`, so it's
                    replicated inline instead of on this div. */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--s-3)' }}>
                  <span className="timeline__text">
                    <span className="timeline__label">{LEG_TYPE_LABEL[leg.leg_type]}</span>
                    <span className="timeline__place">{leg.port.code} — {leg.port.name}{leg.terminal ? `, ${leg.terminal}` : ''}</span>
                  </span>
                  <span className="timeline__time mono" style={{ display: 'flex', flexDirection: 'column', gap: '2px', textAlign: 'right' }}>
                    {/* Arrival before departure: a transshipment leg has both. */}
                    {leg.eta && <span>ETA {formatPortTime(leg.eta, leg.port.tz)}</span>}
                    {leg.etd && <span>ETD {formatPortTime(leg.etd, leg.port.tz)}</span>}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

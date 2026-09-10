import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import ToastStack, { useToasts } from '../components/Toast';
import EmptyState from '../components/EmptyState';
import ShipmentStatusBadge from '../components/ShipmentStatusBadge';
import { MARKER_TONE, SHIPMENTS } from '../data/shipmentMockData';
import { formatShipmentDate } from '../utils/shipmentFormat';

// Docs/CR/prompt-shipment-tracking-interactive-prototype_1.md -- Detail view. Pure client-side
// prototype over the in-memory SHIPMENTS mock; no API calls.

function DocIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

const META_FIELDS = [
  { key: 'container', label: 'Container No.' },
  { key: 'bl', label: 'B/L Number' },
  { key: 'booking', label: 'Booking No.' },
  { key: 'mode', label: 'Mode' },
  { key: 'etd', label: 'ETD', date: true },
  { key: 'eta', label: 'ETA', date: true },
];

const LEGEND = [
  { type: 'origin', label: 'Origin' },
  { type: 'transship', label: 'Transshipment' },
  { type: 'current', label: 'Current position' },
  { type: 'destination', label: 'Destination' },
];

export default function ShipmentDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { toasts, push, dismiss } = useToasts();
  const shipment = useMemo(() => SHIPMENTS.find((s) => s.id === id), [id]);

  const [expandedMilestone, setExpandedMilestone] = useState(null);
  const [hoveredMarker, setHoveredMarker] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const mapRef = useRef(null);
  const copyTimer = useRef(null);

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  function backToList() {
    navigate('/shipment-tracking', { state: { listState: location.state?.listState } });
  }

  if (!shipment) {
    return (
      <div className="shipment-detail-page">
        <div className="breadcrumb">
          <button type="button" className="crumb-link" onClick={backToList}>Shipment Tracking</button>
        </div>
        <EmptyState title="Shipment not found" hint={`No shipment matches "${id}".`} />
      </div>
    );
  }

  function handleMarkerHover(marker, index) {
    const wrap = mapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    setTooltipPos({ x: (marker.x / 100) * rect.width, y: (marker.y / 70) * rect.height });
    setHoveredMarker(index);
  }

  function handleDownload(doc) {
    if (!doc.available) return;
    push({ title: `Downloading ${doc.name}…`, tone: 'success' });
  }

  const shareLink = `${window.location.origin}/track/${shipment.id}`;

  function copyLink() {
    if (navigator.clipboard) navigator.clipboard.writeText(shareLink).catch(() => {});
    setCopied(true);
    push({ title: 'Link copied to clipboard', tone: 'success' });
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="shipment-detail-page">
      <div className="breadcrumb">
        <button type="button" className="crumb-link" onClick={backToList}>Shipment Tracking</button>
        <span aria-hidden="true">/</span>
        <span>{shipment.id}</span>
      </div>
      <div className="page-head">
        <h1>{shipment.id}</h1>
      </div>

      <div className="detail-grid">
        <div className="card detail-header-card">
          <div>
            <h2>{shipment.origin} → {shipment.destination}</h2>
            <ShipmentStatusBadge status={shipment.status} />
            <div className="info-grid">
              {META_FIELDS.map((f) => (
                <div className="info-field" key={f.key}>
                  <dt>{f.label}</dt>
                  <dd className="mono">{f.date ? formatShipmentDate(shipment[f.key]) : shipment[f.key]}</dd>
                </div>
              ))}
            </div>
          </div>
          <div className="detail-actions">
            <button type="button" className="btn-secondary" onClick={() => setShareOpen(true)}>Share</button>
          </div>
        </div>

        <div className="card">
          <h3>Tracking timeline</h3>
          <ul className="timeline">
            {shipment.timeline.map((t, i) => {
              const expanded = expandedMilestone === i;
              return (
                <li key={i} className={`timeline__item timeline__item--${t.state}`}>
                  <span className="timeline__node" aria-hidden="true" />
                  <button
                    type="button"
                    className="timeline__row"
                    aria-expanded={expanded}
                    onClick={() => setExpandedMilestone(expanded ? null : i)}
                  >
                    <span className="timeline__text">
                      <span className="timeline__label">{t.label}</span>
                      <span className="timeline__place">{t.place}</span>
                    </span>
                    <span className="timeline__time mono">{formatShipmentDate(t.time)}</span>
                  </button>
                  {expanded && <div className="timeline__note">{t.note}</div>}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="card">
          <h3>Route map</h3>
          <div className="map-wrap" ref={mapRef}>
            <svg viewBox="0 0 100 70" width="100%" height="100%" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0 }}>
              <polyline className="route-line" points={shipment.map.map((p) => `${p.x},${p.y}`).join(' ')} />
              {shipment.map.map((p, i) => (
                <g
                  key={i}
                  className={`map-marker map-marker--${MARKER_TONE[p.type] || 'neutral'}`}
                  transform={`translate(${p.x},${p.y})`}
                  tabIndex={0}
                  onMouseEnter={() => handleMarkerHover(p, i)}
                  onMouseLeave={() => setHoveredMarker(null)}
                  onFocus={() => handleMarkerHover(p, i)}
                  onBlur={() => setHoveredMarker(null)}
                >
                  <circle r="6" stroke="var(--color-surface)" strokeWidth="1.5" />
                </g>
              ))}
            </svg>
            {hoveredMarker !== null && (
              <div className="map-tooltip" style={{ left: tooltipPos.x, top: tooltipPos.y }}>
                <strong>{shipment.map[hoveredMarker].name}</strong><br />
                {formatShipmentDate(shipment.map[hoveredMarker].time)}
              </div>
            )}
          </div>
          <div className="map-legend">
            {LEGEND.map((l) => (
              <span className="map-legend__item" key={l.type}>
                <span className={`map-legend__swatch map-legend__swatch--${MARKER_TONE[l.type]}`} />
                {l.label}
              </span>
            ))}
          </div>
        </div>

        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <h3>Documents</h3>
          <ul className="doc-list">
            {shipment.documents.map((d) => (
              <li key={d.name}>
                <div className="doc-info">
                  <span className={`doc-icon${d.available ? '' : ' doc-icon--na'}`}>
                    <DocIcon />
                  </span>
                  <div>
                    <div className="doc-name">{d.name}</div>
                    <div className="doc-sub">{d.sub}</div>
                  </div>
                </div>
                <button type="button" className="btn-secondary" disabled={!d.available} onClick={() => handleDownload(d)}>
                  Download
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {shareOpen && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setShareOpen(false); }}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="share-shipment-title">
            <h2 className="modal__title" id="share-shipment-title">Share shipment</h2>
            <p className="muted">Anyone with this link can view read-only tracking details.</p>
            <div className="modal__link-row">
              <input readOnly value={shareLink} onFocus={(e) => e.target.select()} />
              <button type="button" className="btn-primary" onClick={copyLink}>{copied ? 'Copied' : 'Copy link'}</button>
            </div>
            <div className="modal__actions">
              <button type="button" onClick={() => setShareOpen(false)} autoFocus>Close</button>
            </div>
          </div>
        </div>
      )}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { listMaintenanceRequests } from '../api/maintenance';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import TableSkeleton from '../components/TableSkeleton';
import { stripHtml } from '../utils/stripHtml';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_CHIPS_PER_DAY = 3;

function dayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date, delta) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

// Full 7-wide weeks covering the month, including the leading/trailing days of neighboring
// months needed to fill the first and last rows -- the usual month-grid calendar shape.
function buildMonthGrid(monthStart) {
  const gridStart = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1 - monthStart.getDay());
  const lastOfMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  const gridEnd = new Date(lastOfMonth.getFullYear(), lastOfMonth.getMonth(), lastOfMonth.getDate() + (6 - lastOfMonth.getDay()));

  const days = [];
  for (const cursor = new Date(gridStart); cursor <= gridEnd; cursor.setDate(cursor.getDate() + 1)) {
    days.push(new Date(cursor));
  }
  return days;
}

function equipmentName(request) {
  return Array.isArray(request.equipment_id) ? request.equipment_id[1] : null;
}

function stageName(request) {
  return Array.isArray(request.stage_id) ? request.stage_id[1] : null;
}

function typeLabel(request) {
  if (request.maintenance_type === 'preventive') return 'Preventive';
  if (request.maintenance_type === 'corrective') return 'Corrective';
  return request.maintenance_type || '—';
}

// Odoo's maintenance priority is a 0-3 star widget, not a fixed label set -- rendering it as
// stars sidesteps guessing at label text that may not match this instance's configuration.
function priorityStars(request) {
  const level = Number(request.priority) || 0;
  return '★'.repeat(Math.min(level + 1, 4));
}

function RequestRow({ request }) {
  return (
    <div className="maintenance-request-row">
      <div className="maintenance-request-row__main">
        <strong>{request.name}</strong>
        {stageName(request) && <StatusBadge status={stageName(request)} />}
      </div>
      <div className="maintenance-request-row__meta">
        <span>{typeLabel(request)}</span>
        {equipmentName(request) && <span>{equipmentName(request)}</span>}
        {request.duration ? <span>{request.duration}h</span> : null}
        <span className="maintenance-priority" title={`Priority ${Number(request.priority) || 0}`}>
          {priorityStars(request)}
        </span>
      </div>
      {request.description && (
        <p className="muted maintenance-request-row__desc">{stripHtml(request.description)}</p>
      )}
    </div>
  );
}

export default function MaintenancePage() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [monthStart, setMonthStart] = useState(() => startOfMonth(new Date()));
  const [selectedKey, setSelectedKey] = useState(() => dayKey(new Date()));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listMaintenanceRequests()
      .then((data) => {
        if (!cancelled) setRequests(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const eventsByDay = useMemo(() => {
    const map = new Map();
    for (const request of requests) {
      if (!request.schedule_date) continue;
      const key = dayKey(new Date(request.schedule_date));
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(request);
    }
    return map;
  }, [requests]);

  const unscheduled = useMemo(() => requests.filter((r) => !r.schedule_date), [requests]);

  const grid = useMemo(() => buildMonthGrid(monthStart), [monthStart]);
  const todayKey = dayKey(new Date());
  const selectedEvents = eventsByDay.get(selectedKey) || [];

  return (
    <div className="maintenance-page">
      <h1>Schedule Maintenance</h1>
      {error && <p className="error">{error}</p>}

      {loading ? (
        <section className="card">
          <TableSkeleton rows={5} cols={4} />
        </section>
      ) : requests.length === 0 ? (
        <EmptyState
          title="No maintenance requests yet"
          hint="Maintenance requests scheduled by staff in Odoo will appear here on the calendar."
        />
      ) : (
        <>
          <section className="card calendar-card">
            <div className="calendar-header">
              <button type="button" onClick={() => setMonthStart((m) => addMonths(m, -1))} aria-label="Previous month">
                ‹
              </button>
              <h2>{monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
              <button type="button" onClick={() => setMonthStart((m) => addMonths(m, 1))} aria-label="Next month">
                ›
              </button>
              <button
                type="button"
                className="calendar-today-btn"
                onClick={() => {
                  setMonthStart(startOfMonth(new Date()));
                  setSelectedKey(todayKey);
                }}
              >
                Today
              </button>
            </div>

            <div className="calendar-grid calendar-grid--weekdays">
              {WEEKDAY_LABELS.map((label) => (
                <div key={label} className="calendar-weekday">
                  {label}
                </div>
              ))}
            </div>
            <div className="calendar-grid">
              {grid.map((day) => {
                const key = dayKey(day);
                const dayEvents = eventsByDay.get(key) || [];
                const isOutside = day.getMonth() !== monthStart.getMonth();
                const classes = [
                  'calendar-cell',
                  isOutside && 'calendar-cell--outside',
                  key === todayKey && 'calendar-cell--today',
                  key === selectedKey && 'calendar-cell--selected',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <button type="button" key={key} className={classes} onClick={() => setSelectedKey(key)}>
                    <span className="calendar-cell__date">{day.getDate()}</span>
                    <span className="calendar-cell__events">
                      {dayEvents.slice(0, MAX_CHIPS_PER_DAY).map((event) => (
                        <span key={event.id} className="calendar-chip">
                          {event.name}
                        </span>
                      ))}
                      {dayEvents.length > MAX_CHIPS_PER_DAY && (
                        <span className="calendar-chip calendar-chip--more">+{dayEvents.length - MAX_CHIPS_PER_DAY} more</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="card">
            <h2>
              {new Date(`${selectedKey}T00:00:00`).toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </h2>
            {selectedEvents.length === 0 ? (
              <p className="muted">No maintenance scheduled on this day.</p>
            ) : (
              <div className="maintenance-request-list">
                {selectedEvents.map((request) => (
                  <RequestRow key={request.id} request={request} />
                ))}
              </div>
            )}
          </section>

          {unscheduled.length > 0 && (
            <section className="card">
              <h2>Unscheduled requests</h2>
              <p className="muted">These maintenance requests don't have a scheduled date yet.</p>
              <div className="maintenance-request-list">
                {unscheduled.map((request) => (
                  <RequestRow key={request.id} request={request} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

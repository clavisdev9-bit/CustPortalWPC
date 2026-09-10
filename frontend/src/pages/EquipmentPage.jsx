import { Fragment, useEffect, useMemo, useState } from 'react';
import { listEquipment } from '../api/equipment';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import TableSkeleton from '../components/TableSkeleton';
import EquipmentDetailPanel from '../components/EquipmentDetailPanel';

const STATUS_OPTIONS = ['active', 'idle', 'decommissioned'];

export default function EquipmentPage() {
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [locationFilter, setLocationFilter] = useState('all');
  const [detailOpenId, setDetailOpenId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listEquipment()
      .then((data) => {
        if (!cancelled) setUnits(data);
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

  // Filtered client-side, same as every other list page in this app -- Fase 1 fleets are small
  // enough (single GET /equipment, <=3 Odoo calls) that a server-side filter endpoint isn't
  // justified yet.
  const locations = useMemo(
    () => [...new Set(units.map((u) => u.location).filter(Boolean))].sort(),
    [units]
  );

  const filtered = useMemo(
    () =>
      units.filter(
        (u) =>
          (statusFilter === 'all' || u.status === statusFilter) &&
          (locationFilter === 'all' || u.location === locationFilter)
      ),
    [units, statusFilter, locationFilter]
  );

  return (
    <div className="equipment-page">
      <h1>My Equipment</h1>
      <p className="muted">
        Machines registered to your company in Odoo. Covers units delivered with a tracked serial
        number -- if something you own is missing here, contact support.
      </p>
      {error && <p className="error">{error}</p>}

      <section className="card">
        {loading ? (
          <TableSkeleton cols={6} />
        ) : units.length === 0 ? (
          <EmptyState title="No equipment on record yet" hint="Machines delivered to your company will appear here." />
        ) : (
          <>
            <div className="filter-row">
              <label>
                Status
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="all">All</option>
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Location
                <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
                  <option value="all">All</option>
                  {locations.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {filtered.length === 0 ? (
              <EmptyState title="No equipment matches this filter" hint="Try a different status or location." />
            ) : (
              <table className="table--cards">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Serial</th>
                    <th>Model</th>
                    <th>Location</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u) => (
                    <Fragment key={u.id}>
                      <tr>
                        <td data-label="Name">{u.name}</td>
                        <td data-label="Serial">{u.serial_number || '-'}</td>
                        <td data-label="Model">{u.model?.name || '-'}</td>
                        <td data-label="Location">{u.location || '-'}</td>
                        <td data-label="Status">
                          <StatusBadge status={u.status || 'Unknown'} />
                        </td>
                        <td className="button-row">
                          <button type="button" onClick={() => setDetailOpenId(detailOpenId === u.id ? null : u.id)}>
                            Details
                          </button>
                        </td>
                      </tr>
                      {detailOpenId === u.id && (
                        <tr className="documents-row">
                          <td colSpan={6}>
                            <EquipmentDetailPanel equipmentId={u.id} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getDueReplacements } from '../api/equipment';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import TableSkeleton from '../components/TableSkeleton';

export default function DueReplacementsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getDueReplacements()
      .then((data) => {
        if (!cancelled) setRows(data);
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

  return (
    <div className="due-replacements-page">
      <h1>Due Replacements</h1>
      <p className="muted">
        Parts due or nearing due for replacement, based on your last purchase (or install date if
        never purchased). Rows marked "fleet estimate" cover multiple identical units and cannot be
        tied to one specific unit -- treat them as an estimate, not a fact.
      </p>
      {error && <p className="error">{error}</p>}

      <section className="card">
        {loading ? (
          <TableSkeleton cols={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Nothing due right now"
            hint="Either everything is within its service interval, or the service catalog doesn't cover your equipment yet."
          />
        ) : (
          <table className="table--cards">
            <thead>
              <tr>
                <th>Equipment</th>
                <th>Part</th>
                <th>Status</th>
                <th>Due date</th>
                <th>Basis</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={`${row.equipment_id}-${row.part.product_id}-${i}`}>
                  <td data-label="Equipment">{row.equipment_name}</td>
                  <td data-label="Part">
                    {row.part.name}
                    {row.upgrade && (
                      <div className="muted" style={{ fontSize: '0.8rem' }}>
                        Upgrade available: {row.upgrade.name}
                        {row.upgrade.note ? ` -- ${row.upgrade.note}` : ''}
                      </div>
                    )}
                  </td>
                  <td data-label="Status">
                    <StatusBadge status={row.status} />
                    {row.status === 'overdue' && row.days_overdue != null && (
                      <span className="muted" style={{ marginLeft: 6 }}>
                        {row.days_overdue}d
                      </span>
                    )}
                  </td>
                  <td data-label="Due date">{row.due_date}</td>
                  <td data-label="Basis">
                    {row.basis === 'last_purchase' ? 'Last purchase' : 'Install date'} ({row.basis_date})
                    {row.attribution === 'fleet_estimated' && (
                      <div className="muted" style={{ fontSize: '0.8rem' }} title={row.attribution_note}>
                        Fleet estimate
                      </div>
                    )}
                  </td>
                  <td className="button-row">
                    <Link to="/requests">
                      <button type="button">Request a quote</button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

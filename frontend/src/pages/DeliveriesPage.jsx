import { Fragment, useEffect, useState } from 'react';
import { listDeliveries, confirmDelivery } from '../api/deliveries';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import TableSkeleton from '../components/TableSkeleton';
import DocumentsPanel from '../components/DocumentsPanel';

export default function DeliveriesPage() {
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);
  const [notes, setNotes] = useState('');
  const [docsOpenId, setDocsOpenId] = useState(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setDeliveries(await listDeliveries());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleConfirm(e) {
    e.preventDefault();
    const file = e.target.elements.signature?.files[0];
    setError(null);
    try {
      await confirmDelivery(confirmingId, { notes, file });
      setConfirmingId(null);
      setNotes('');
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="deliveries-page">
      <h1>Deliveries</h1>
      {error && <p className="error">{error}</p>}
      <section className="card">
        {loading ? (
          <TableSkeleton cols={5} />
        ) : deliveries.length === 0 ? (
          <EmptyState title="No deliveries yet" hint="Scheduled and completed deliveries will appear here." />
        ) : (
          <table className="table--cards">
            <thead>
              <tr>
                <th>Number</th>
                <th>Scheduled</th>
                <th>Status</th>
                <th>Tracking</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => (
                <Fragment key={d.id}>
                  <tr>
                    <td data-label="Number">{d.name}</td>
                    <td data-label="Scheduled">{d.scheduled_date ? new Date(d.scheduled_date).toLocaleDateString() : '-'}</td>
                    <td data-label="Status"><StatusBadge status={d.portal_status} /></td>
                    <td data-label="Tracking">{d.carrier_tracking_ref || '-'}</td>
                    <td className="button-row">
                      {d.portal_status !== 'Delivered' && (
                        <button onClick={() => setConfirmingId(d.id)}>Confirm receipt</button>
                      )}
                      <button type="button" onClick={() => setDocsOpenId(docsOpenId === d.id ? null : d.id)}>
                        Documents
                      </button>
                    </td>
                  </tr>
                  {docsOpenId === d.id && (
                    <tr className="documents-row">
                      <td colSpan={5}>
                        <DocumentsPanel resourceType="deliveries" recordId={d.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {confirmingId && (
        <section className="card">
          <h2>Confirm delivery #{confirmingId}</h2>
          <form onSubmit={handleConfirm} className="form-grid">
            <label>
              Notes
              <input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            <label>
              Signature / photo (optional)
              <input type="file" name="signature" />
            </label>
            <div className="button-row">
              <button type="submit">Confirm</button>
              <button type="button" onClick={() => setConfirmingId(null)}>
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}

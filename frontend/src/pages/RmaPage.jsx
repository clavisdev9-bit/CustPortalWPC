import { useEffect, useState } from 'react';
import { listRma, createRma } from '../api/rma';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import TableSkeleton from '../components/TableSkeleton';
import RichTextEditor from '../components/RichTextEditor';
import { stripHtml } from '../utils/stripHtml';

const EMPTY_FORM = { order_id: '', reason: '', requested_action: 'replacement' };

export default function RmaPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setItems(await listRma());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    // RichTextEditor isn't a native form control, so the browser's `required` validation on
    // reason no longer fires -- checked here instead, against the stripped text like elsewhere.
    if (!stripHtml(form.reason).trim()) {
      setError('Reason is required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createRma({
        order_id: form.order_id ? Number(form.order_id) : undefined,
        reason: form.reason,
        requested_action: form.requested_action,
      });
      setForm(EMPTY_FORM);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rma-page">
      <h1>RMA / Return</h1>
      <p className="muted">
        There is no dedicated RMA workflow in Odoo yet (that needs a custom module -- see spec
        section 27). Each request here creates a linked Helpdesk ticket; status below is read
        live from that ticket, not stored separately.
      </p>
      {error && <p className="error">{error}</p>}

      <section className="card">
        <h2>New RMA request</h2>
        <form onSubmit={handleSubmit} className="form-grid">
          <label>
            Order number (optional)
            <input type="number" value={form.order_id} onChange={(e) => setForm({ ...form, order_id: e.target.value })} />
          </label>
          <label>
            Requested action
            <select value={form.requested_action} onChange={(e) => setForm({ ...form, requested_action: e.target.value })}>
              <option value="replacement">Replacement</option>
              <option value="refund">Refund</option>
            </select>
          </label>
          <label>
            Reason
            <RichTextEditor value={form.reason} onChange={(html) => setForm({ ...form, reason: html })} disabled={submitting} />
          </label>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Submitting...' : 'Submit request'}
          </button>
        </form>
      </section>

      <section className="card">
        <h2>My RMA requests</h2>
        {loading ? (
          <TableSkeleton cols={5} />
        ) : items.length === 0 ? (
          <EmptyState title="No RMA requests yet" hint="Return requests you submit will be tracked here." />
        ) : (
          <table className="table--cards">
            <thead>
              <tr>
                <th>Order</th>
                <th>Action</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id}>
                  <td data-label="Order">{r.odoo_order_id || '-'}</td>
                  <td data-label="Action">{r.requested_action}</td>
                  <td data-label="Reason">{stripHtml(r.reason)}</td>
                  <td data-label="Status"><StatusBadge status={r.status || 'Unknown'} /></td>
                  <td data-label="Submitted">{new Date(r.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

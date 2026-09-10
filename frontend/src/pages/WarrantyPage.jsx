import { useEffect, useState } from 'react';
import { listWarrantyClaims, createWarrantyClaim, lookupSerial } from '../api/warranty';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import TableSkeleton from '../components/TableSkeleton';
import RichTextEditor from '../components/RichTextEditor';
import { stripHtml } from '../utils/stripHtml';

const EMPTY_FORM = { serial_number: '', issue_description: '' };

export default function WarrantyPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [lookupResult, setLookupResult] = useState('idle');
  const [looking, setLooking] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setItems(await listWarrantyClaims());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleLookup() {
    if (!form.serial_number) return;
    setLooking(true);
    setError(null);
    try {
      setLookupResult(await lookupSerial(form.serial_number));
    } catch (err) {
      setError(err.message);
    } finally {
      setLooking(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    // RichTextEditor isn't a native form control, so the browser's `required` validation on
    // issue_description no longer fires -- checked here instead, against the stripped text.
    if (!stripHtml(form.issue_description).trim()) {
      setError('Issue description is required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createWarrantyClaim(form);
      setForm(EMPTY_FORM);
      setLookupResult('idle');
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="warranty-page">
      <h1>Warranty</h1>
      <p className="muted">
        There is no dedicated Warranty workflow in Odoo yet (see spec section 27). Serial lookup
        only confirms the serial exists in Odoo inventory -- it does not verify you purchased
        that unit or compute warranty eligibility; staff verify that on the linked ticket.
      </p>
      {error && <p className="error">{error}</p>}

      <section className="card">
        <h2>New warranty claim</h2>
        <form onSubmit={handleSubmit} className="form-grid">
          <label>
            Serial number
            <input
              required
              value={form.serial_number}
              onChange={(e) => {
                setForm({ ...form, serial_number: e.target.value });
                setLookupResult('idle');
              }}
            />
          </label>
          <div className="button-row">
            <button type="button" onClick={handleLookup} disabled={looking || !form.serial_number}>
              {looking ? 'Checking...' : 'Check serial'}
            </button>
          </div>
          {lookupResult !== 'idle' &&
            (lookupResult ? (
              <p className="success">
                Found: {lookupResult.name} ({lookupResult.product_id?.[1] || 'unknown product'})
              </p>
            ) : (
              <p className="error">Serial not found in Odoo inventory records.</p>
            ))}
          <label>
            Issue description
            <RichTextEditor
              value={form.issue_description}
              onChange={(html) => setForm({ ...form, issue_description: html })}
              disabled={submitting}
            />
          </label>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Submitting...' : 'Submit claim'}
          </button>
        </form>
      </section>

      <section className="card">
        <h2>My warranty claims</h2>
        {loading ? (
          <TableSkeleton cols={4} />
        ) : items.length === 0 ? (
          <EmptyState title="No warranty claims yet" hint="Warranty claims you submit will be tracked here." />
        ) : (
          <table className="table--cards">
            <thead>
              <tr>
                <th>Serial</th>
                <th>Issue</th>
                <th>Status</th>
                <th>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td data-label="Serial">{c.serial_number}</td>
                  <td data-label="Issue">{stripHtml(c.issue_description)}</td>
                  <td data-label="Status"><StatusBadge status={c.status || 'Unknown'} /></td>
                  <td data-label="Submitted">{new Date(c.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

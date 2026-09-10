import { Fragment, useEffect, useState } from 'react';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import TableSkeleton from '../components/TableSkeleton';
import DocumentsPanel from '../components/DocumentsPanel';
import TicketDetailPanel from '../components/TicketDetailPanel';
import RichTextEditor from '../components/RichTextEditor';
import { listTickets, createTicket } from '../api/tickets';

const EMPTY_FORM = { name: '', description: '' };

export default function TicketsPage() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const [detailOpenId, setDetailOpenId] = useState(null);
  const [docsOpenId, setDocsOpenId] = useState(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setTickets(await listTickets());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createTicket(form);
      setForm(EMPTY_FORM);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="tickets-page">
      <h1>Helpdesk Tickets</h1>
      {error && <p className="error">{error}</p>}

      <section className="card">
        <h2>New ticket</h2>
        <form onSubmit={handleCreate} className="form-grid">
          <label>
            Subject
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            Description
            <RichTextEditor value={form.description} onChange={(html) => setForm({ ...form, description: html })} disabled={submitting} />
          </label>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Creating...' : 'Create ticket'}
          </button>
        </form>
      </section>

      <section className="card">
        <h2>My tickets</h2>
        {loading ? (
          <TableSkeleton cols={5} />
        ) : tickets.length === 0 ? (
          <EmptyState title="No tickets yet" hint="Support tickets you open will appear here." />
        ) : (
          <table className="table--cards">
            <thead>
              <tr>
                <th>Subject</th>
                <th>Stage</th>
                <th>Priority</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <Fragment key={t.id}>
                  <tr>
                    <td data-label="Subject">{t.name}</td>
                    <td data-label="Stage"><StatusBadge status={t.stage_id?.[1]} /></td>
                    <td data-label="Priority">{t.priority}</td>
                    <td data-label="Created">{new Date(t.create_date).toLocaleDateString()}</td>
                    <td className="button-row">
                      <button type="button" onClick={() => setDetailOpenId(detailOpenId === t.id ? null : t.id)}>
                        Details
                      </button>
                      <button type="button" onClick={() => setDocsOpenId(docsOpenId === t.id ? null : t.id)}>
                        Documents
                      </button>
                    </td>
                  </tr>
                  {detailOpenId === t.id && (
                    <tr className="documents-row">
                      <td colSpan={5}>
                        <TicketDetailPanel
                          ticketId={t.id}
                          onUpdate={(updated) =>
                            setTickets((prev) => prev.map((row) => (row.id === updated.id ? updated : row)))
                          }
                        />
                      </td>
                    </tr>
                  )}
                  {docsOpenId === t.id && (
                    <tr className="documents-row">
                      <td colSpan={5}>
                        <DocumentsPanel resourceType="tickets" recordId={t.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

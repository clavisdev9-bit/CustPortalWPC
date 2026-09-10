import { useEffect, useState } from 'react';
import { getTicket, listTicketMessages, postTicketMessage, closeTicket, reopenTicket, uploadTicketAttachment } from '../api/tickets';
import { stripHtml } from '../utils/stripHtml';
import RichTextEditor from './RichTextEditor';
import SafeHtml from './SafeHtml';

// Same background-refresh cadence as NotificationBell.jsx -- while a ticket is open, this polls
// for chatter updates made directly in Odoo (by support staff) so the customer sees them without
// closing and reopening the panel.
const POLL_INTERVAL_MS = 30_000;

// Dropped inline under a ticket's own row, same placement rule as DocumentsPanel -- ticket detail,
// communication history and close/reopen are all scoped to one ticket. Mirrors
// QuotationDetailPanel's fetch-on-mount + communication-history pattern now that the helpdesk API
// has its own message-listing endpoint (GET/POST /tickets/:id/messages).
export default function TicketDetailPanel({ ticketId, onUpdate }) {
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState(null);
  const [messages, setMessages] = useState(null);
  const [messagesError, setMessagesError] = useState(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getTicket(ticketId)
      .then((t) => {
        if (!cancelled) setTicket(t);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [ticketId]);

  useEffect(() => {
    let cancelled = false;

    // showErrors is false for background polls, so a transient poll failure doesn't overwrite an
    // already-loaded thread with an error banner -- only the initial load surfaces one.
    function fetchMessages(showErrors) {
      return listTicketMessages(ticketId)
        .then((rows) => {
          if (!cancelled) setMessages(rows);
        })
        .catch((err) => {
          if (!cancelled && showErrors) setMessagesError(err.message);
        });
    }

    fetchMessages(true);
    const interval = setInterval(() => fetchMessages(false), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [ticketId]);

  async function handleSend(e) {
    e.preventDefault();
    // draft is HTML now (rich text editor), so an "empty" value isn't '' -- it's markup like
    // <p></p> with no visible text, hence checking the stripped text instead of the raw string.
    if (!stripHtml(draft).trim()) return;
    setSending(true);
    setSendError(null);
    try {
      setMessages(await postTicketMessage(ticketId, draft));
      setDraft('');
    } catch (err) {
      setSendError(err.message);
    } finally {
      setSending(false);
    }
  }

  async function handleAttach(e) {
    const file = e.target.files[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setTicket(await uploadTicketAttachment(ticketId, file));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  async function handleClose() {
    setBusy(true);
    setError(null);
    try {
      const updated = await closeTicket(ticketId);
      setTicket(updated);
      onUpdate?.(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleReopen() {
    setBusy(true);
    setError(null);
    try {
      const updated = await reopenTicket(ticketId);
      setTicket(updated);
      onUpdate?.(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="error">Could not load ticket: {error}</p>;
  if (!ticket) return <p className="muted">Loading ticket...</p>;

  return (
    <div className="quotation-detail-panel">
      <div>
        <p className="muted">
          Stage: {ticket.stage_id?.[1] || '-'} · Priority: {ticket.priority || '-'} · Team:{' '}
          {ticket.team_id?.[1] || '-'}
        </p>
        {ticket.description && <SafeHtml html={ticket.description} />}
        <div className="button-row">
          <button disabled={busy} onClick={handleClose}>
            Close
          </button>
          <button disabled={busy} onClick={handleReopen}>
            Reopen
          </button>
        </div>
      </div>

      <div className="communication-history">
        <h3>Communication history</h3>
        {messagesError && <p className="error">Could not load messages: {messagesError}</p>}
        {!messagesError && !messages && <p className="muted">Loading messages...</p>}
        {messages && messages.length === 0 && <p className="muted">No messages yet.</p>}
        {messages && messages.length > 0 && (
          <ul className="communication-history-list">
            {messages.map((m) => (
              <li key={m.id}>
                <div className="communication-history__meta">
                  <span>{m.author_id?.[1] || 'System'}</span>
                  <span className="muted">{m.date ? new Date(m.date).toLocaleString() : ''}</span>
                </div>
                <SafeHtml className="communication-history__body" html={m.body} />
              </li>
            ))}
          </ul>
        )}

        {sendError && <p className="error">Could not send message: {sendError}</p>}
        <form onSubmit={handleSend} className="form-grid reply-form">
          <label>
            Write a message
            <RichTextEditor value={draft} onChange={setDraft} disabled={sending} />
          </label>
          <button type="submit" disabled={sending || !stripHtml(draft).trim()}>
            {sending ? 'Sending...' : 'Send'}
          </button>
        </form>

        <label className="file-field">
          Attach a file
          <input type="file" onChange={handleAttach} disabled={busy} />
        </label>
      </div>
    </div>
  );
}

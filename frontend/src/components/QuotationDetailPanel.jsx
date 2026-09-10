import { useEffect, useState } from 'react';
import { listQuotationLines, listQuotationMessages, postQuotationMessage } from '../api/quotations';
import SafeHtml from './SafeHtml';

// Dropped inline under a quotation's own row, same placement rule as DocumentsPanel -- both the
// product breakdown and the communication history are scoped to one quotation.
export default function QuotationDetailPanel({ quotationId }) {
  const [lines, setLines] = useState(null);
  const [linesError, setLinesError] = useState(null);
  const [messages, setMessages] = useState(null);
  const [messagesError, setMessagesError] = useState(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    listQuotationLines(quotationId)
      .then((rows) => {
        if (!cancelled) setLines(rows);
      })
      .catch((err) => {
        if (!cancelled) setLinesError(err.message);
      });
    listQuotationMessages(quotationId)
      .then((rows) => {
        if (!cancelled) setMessages(rows);
      })
      .catch((err) => {
        if (!cancelled) setMessagesError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [quotationId]);

  async function handleSend(e) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    setSendError(null);
    try {
      setMessages(await postQuotationMessage(quotationId, body));
      setDraft('');
    } catch (err) {
      setSendError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="quotation-detail-panel">
      <div>
        <h3>Products</h3>
        {linesError && <p className="error">Could not load products: {linesError}</p>}
        {!linesError && !lines && <p className="muted">Loading products...</p>}
        {lines && lines.length === 0 && <p className="muted">No line items on this quotation.</p>}
        {lines && lines.length > 0 && (
          <table className="table--cards">
            <thead>
              <tr>
                <th>Product</th>
                <th>Quantity</th>
                <th>Unit Price</th>
                <th>Taxes</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id}>
                  <td data-label="Product">{line.product_id?.[1] || line.name}</td>
                  <td data-label="Quantity">
                    {line.product_uom_qty?.toLocaleString()} {line.product_uom?.[1] || ''}
                  </td>
                  <td data-label="Unit Price">{line.price_unit?.toLocaleString()}</td>
                  <td data-label="Taxes">{line.taxes?.length ? line.taxes.join(', ') : '-'}</td>
                  <td data-label="Amount">{line.price_subtotal?.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Write a message..." />
          </label>
          <button type="submit" disabled={sending || !draft.trim()}>
            {sending ? 'Sending...' : 'Send'}
          </button>
        </form>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { listDocuments, getDocumentBlob } from '../api/documents';
import { downloadBlob } from '../utils/download';

// Same background-refresh cadence as NotificationBell.jsx / TicketDetailPanel.jsx -- while a
// record's documents are open, poll so a file attached directly in Odoo shows up without the
// customer having to close and reopen the panel.
const POLL_INTERVAL_MS = 30_000;

// Dropped inline under a record's own row (Quotations/Orders/Invoices/Deliveries) rather than
// living on a standalone page -- documents are always scoped to one record (section 31's
// "Documents: Per-record only, see each item's Documents tab").
export default function DocumentsPanel({ resourceType, recordId }) {
  const [documents, setDocuments] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    let cancelled = false;

    // showErrors is false for background polls, so a transient poll failure doesn't overwrite an
    // already-loaded list with an error banner -- only the initial load surfaces one.
    function fetchDocuments(showErrors) {
      return listDocuments(resourceType, recordId)
        .then((docs) => {
          if (!cancelled) setDocuments(docs);
        })
        .catch((err) => {
          if (!cancelled && showErrors) setError(err.message);
        });
    }

    fetchDocuments(true);
    const interval = setInterval(() => fetchDocuments(false), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [resourceType, recordId]);

  async function handleDownload(doc) {
    setBusyId(doc.id);
    setError(null);
    try {
      const blob = await getDocumentBlob(resourceType, recordId, doc.id);
      downloadBlob(blob, doc.name);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  if (error) return <p className="error">Could not load documents: {error}</p>;
  if (!documents) return <p className="muted">Loading documents...</p>;
  if (documents.length === 0) return <p className="muted">No documents attached to this record yet.</p>;

  return (
    <ul className="documents-panel-list">
      {documents.map((doc) => (
        <li key={doc.id}>
          <span>{doc.name}</span>
          <span className="muted">{doc.create_date ? new Date(doc.create_date).toLocaleDateString() : ''}</span>
          <button type="button" disabled={busyId === doc.id} onClick={() => handleDownload(doc)}>
            Download
          </button>
        </li>
      ))}
    </ul>
  );
}

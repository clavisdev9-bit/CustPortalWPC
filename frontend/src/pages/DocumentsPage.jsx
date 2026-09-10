import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  listInbox,
  downloadShared,
  listSent,
  searchRecipients,
  shareDocument,
  revokeShare,
} from '../api/documentShares';
import { downloadBlob } from '../utils/download';
import EmptyState from '../components/EmptyState';
import TableSkeleton from '../components/TableSkeleton';

// Recipient inbox -- documents shared *with* the logged-in customer (scoped server-side to their
// exact Odoo partner in the current connection).
function Inbox() {
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    listInbox()
      .then((d) => !cancelled && setDocs(d))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleDownload(doc) {
    setBusyId(doc.id);
    setError(null);
    try {
      const blob = await downloadShared(doc.id);
      downloadBlob(blob, doc.filename);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="card">
      <h2>Shared with me</h2>
      {error && <p className="error">{error}</p>}
      {!docs ? (
        <TableSkeleton cols={4} />
      ) : docs.length === 0 ? (
        <EmptyState title="No documents yet" hint="Documents shared with you will appear here." />
      ) : (
        <table className="table--cards">
          <thead>
            <tr>
              <th>File</th>
              <th>Category</th>
              <th>Source</th>
              <th>Shared</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {docs.map((doc) => (
              <tr key={doc.id}>
                <td data-label="File">
                  {doc.filename}
                  {doc.note && <div className="muted">{doc.note}</div>}
                </td>
                <td data-label="Category">{doc.category || '-'}</td>
                <td data-label="Source">{doc.source === 'odoo' ? 'Odoo Documents' : 'Portal'}</td>
                <td data-label="Shared">{new Date(doc.created_at).toLocaleString()}</td>
                <td>
                  <button type="button" disabled={busyId === doc.id} onClick={() => handleDownload(doc)}>
                    {busyId === doc.id ? 'Downloading...' : 'Download'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// Sender panel -- internal staff share a file to one exact customer partner. Shown only for the
// "Staff (Internal)" role; the API itself is the real gate (requirePermission('document.share')).
function SharePanel() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [recipientId, setRecipientId] = useState('');
  const [file, setFile] = useState(null);
  const [category, setCategory] = useState('');
  const [note, setNote] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [okMsg, setOkMsg] = useState(null);

  const [sent, setSent] = useState([]);
  const [revokingId, setRevokingId] = useState(null);

  async function refreshSent() {
    try {
      setSent(await listSent());
    } catch {
      /* non-fatal for the share form itself */
    }
  }

  useEffect(() => {
    refreshSent();
  }, []);

  async function handleSearch(e) {
    e.preventDefault();
    setSearching(true);
    setError(null);
    try {
      const rows = await searchRecipients(query);
      setResults(rows);
      if (rows.length === 0) setError('No matching customers found.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!recipientId || !file) return;
    setSubmitting(true);
    setError(null);
    setOkMsg(null);
    try {
      const form = new FormData();
      form.append('recipient_partner_id', recipientId);
      form.append('file', file);
      if (category.trim()) form.append('category', category.trim());
      if (note.trim()) form.append('note', note.trim());
      if (expiresAt) form.append('expires_at', expiresAt);
      const result = await shareDocument(form);
      setOkMsg(`Shared "${result.filename}" with ${result.recipient.name}.`);
      setFile(null);
      setCategory('');
      setNote('');
      setExpiresAt('');
      // reset the native file input
      e.target.reset();
      await refreshSent();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke(id) {
    setRevokingId(id);
    setError(null);
    try {
      await revokeShare(id);
      await refreshSent();
    } catch (err) {
      setError(err.message);
    } finally {
      setRevokingId(null);
    }
  }

  const selectedRecipient = results.find((r) => String(r.id) === recipientId);

  return (
    <>
      <section className="card">
        <h2>Share a document</h2>
        <p className="muted">
          The file is delivered to exactly one customer contact. Only portal users mapped to that
          contact can see or download it -- no one else, and never via a public link.
        </p>
        {error && <p className="error">{error}</p>}
        {okMsg && <p className="success">{okMsg}</p>}

        <form onSubmit={handleSearch} className="line-item-picker">
          <label style={{ flex: '1 1 260px' }}>
            Find recipient (name or email)
            <input
              type="text"
              placeholder="e.g. Purbaningrum or purbaningruma@gmail.com"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <button type="submit" disabled={searching}>
            {searching ? 'Searching...' : 'Search'}
          </button>
        </form>

        <form onSubmit={handleSubmit} className="form-grid" style={{ maxWidth: 'none', marginTop: 'var(--s-4)' }}>
          <label>
            Recipient
            <select value={recipientId} onChange={(e) => setRecipientId(e.target.value)}>
              <option value="">Select a customer contact...</option>
              {results.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.email ? ` <${r.email}>` : ''}
                </option>
              ))}
            </select>
          </label>

          <label>
            File
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>

          <label>
            Category (optional)
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Contract, Invoice, POD, ..."
            />
          </label>

          <label>
            Note (optional)
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Message to the recipient" />
          </label>

          <label>
            Expires (optional)
            <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </label>

          {selectedRecipient && (
            <p className="muted">
              Will be visible to: <strong>{selectedRecipient.name}</strong>
              {selectedRecipient.email ? ` (${selectedRecipient.email})` : ''} only.
            </p>
          )}

          <button type="submit" disabled={submitting || !recipientId || !file}>
            {submitting ? 'Sharing...' : 'Share document'}
          </button>
        </form>
      </section>

      <section className="card">
        <h2>Documents I've shared</h2>
        {sent.length === 0 ? (
          <EmptyState title="Nothing shared yet" hint="Documents you share will be listed here for your records." />
        ) : (
          <table className="table--cards">
            <thead>
              <tr>
                <th>File</th>
                <th>Recipient</th>
                <th>Category</th>
                <th>Shared</th>
                <th>Expires</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sent.map((s) => {
                const expired = s.expires_at && new Date(s.expires_at) <= new Date();
                const status = s.revoked_at ? 'Revoked' : expired ? 'Expired' : 'Active';
                return (
                  <tr key={s.id}>
                    <td data-label="File">{s.filename}</td>
                    <td data-label="Recipient">{s.recipient_name || `#${s.recipient_partner_id}`}</td>
                    <td data-label="Category">{s.category || '-'}</td>
                    <td data-label="Shared">{new Date(s.created_at).toLocaleString()}</td>
                    <td data-label="Expires">{s.expires_at ? new Date(s.expires_at).toLocaleDateString() : '-'}</td>
                    <td data-label="Status">{status}</td>
                    <td>
                      {!s.revoked_at && (
                        <button type="button" disabled={revokingId === s.id} onClick={() => handleRevoke(s.id)}>
                          {revokingId === s.id ? 'Revoking...' : 'Revoke'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

export default function DocumentsPage() {
  const { user } = useAuth();
  // Platform admins are authorized to share via the backend's requirePermission bypass, so the form
  // must be visible to them too -- not only to holders of the 'Staff (Internal)' role.
  const canShare =
    !!user?.is_platform_admin || (Array.isArray(user?.roles) && user.roles.includes('Staff (Internal)'));

  return (
    <div className="documents-page">
      <h1>Documents</h1>
      <p className="muted">
        Documents appear here when shared through this portal's own document sharing feature (the
        panel below, used by our team) or shared directly with your contact from Odoo's Documents
        app -- both are shown together below.
      </p>
      {canShare && <SharePanel />}
      <Inbox />
    </div>
  );
}

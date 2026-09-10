import { Fragment, useEffect, useState } from 'react';
import { listQuotations, approveQuotation, rejectQuotation, signQuotation, getQuotationPdfBlob } from '../api/quotations';
import SignaturePad from '../components/SignaturePad';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import TableSkeleton from '../components/TableSkeleton';
import DocumentsPanel from '../components/DocumentsPanel';
import QuotationDetailPanel from '../components/QuotationDetailPanel';
import { downloadBlob } from '../utils/download';

export default function QuotationsPage() {
  const [quotations, setQuotations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [pdfBusyId, setPdfBusyId] = useState(null);
  const [signingId, setSigningId] = useState(null);
  const [signature, setSignature] = useState(null);
  const [signedBy, setSignedBy] = useState('');
  const [docsOpenId, setDocsOpenId] = useState(null);
  const [detailOpenId, setDetailOpenId] = useState(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setQuotations(await listQuotations());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleApprove(id) {
    setBusyId(id);
    setError(null);
    try {
      await approveQuotation(id);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(id) {
    const reason = window.prompt('Reason for rejecting this quotation (optional):') || undefined;
    setBusyId(id);
    setError(null);
    try {
      await rejectQuotation(id, reason);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDownloadPdf(quotation) {
    setPdfBusyId(quotation.id);
    setError(null);
    try {
      const blob = await getQuotationPdfBlob(quotation.id);
      downloadBlob(blob, `${quotation.name}.pdf`);
    } catch (err) {
      setError(err.message);
    } finally {
      setPdfBusyId(null);
    }
  }

  async function handleSign(e) {
    e.preventDefault();
    if (!signature) {
      setError('Draw a signature first.');
      return;
    }
    setBusyId(signingId);
    setError(null);
    try {
      await signQuotation(signingId, signature, signedBy);
      setSigningId(null);
      setSignature(null);
      setSignedBy('');
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="quotations-page">
      <h1>Quotations</h1>
      {error && <p className="error">{error}</p>}
      <section className="card">
        {loading ? (
          <TableSkeleton cols={5} />
        ) : quotations.length === 0 ? (
          <EmptyState title="No quotations to review" hint="Quotations sent to you for approval will show up here." />
        ) : (
          <table className="table--cards">
            <thead>
              <tr>
                <th>Number</th>
                <th>Date</th>
                <th>Total</th>
                <th>State</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {quotations.map((q) => (
                <Fragment key={q.id}>
                  <tr>
                    <td data-label="Number">{q.name}</td>
                    <td data-label="Date">{q.date_order ? new Date(q.date_order).toLocaleDateString() : '-'}</td>
                    <td data-label="Total">{q.amount_total?.toLocaleString()}</td>
                    <td data-label="State"><StatusBadge status={q.state} /></td>
                    <td className="button-row">
                      <button disabled={busyId === q.id} onClick={() => handleApprove(q.id)}>
                        Approve
                      </button>
                      <button disabled={busyId === q.id} onClick={() => setSigningId(q.id)}>
                        Sign &amp; Approve
                      </button>
                      <button disabled={busyId === q.id} onClick={() => handleReject(q.id)}>
                        Reject
                      </button>
                      <button disabled={pdfBusyId === q.id} onClick={() => handleDownloadPdf(q)}>
                        {pdfBusyId === q.id ? 'Downloading...' : 'Download PDF'}
                      </button>
                      <button type="button" onClick={() => setDetailOpenId(detailOpenId === q.id ? null : q.id)}>
                        Details
                      </button>
                      <button type="button" onClick={() => setDocsOpenId(docsOpenId === q.id ? null : q.id)}>
                        Documents
                      </button>
                    </td>
                  </tr>
                  {detailOpenId === q.id && (
                    <tr className="documents-row">
                      <td colSpan={5}>
                        <QuotationDetailPanel quotationId={q.id} />
                      </td>
                    </tr>
                  )}
                  {docsOpenId === q.id && (
                    <tr className="documents-row">
                      <td colSpan={5}>
                        <DocumentsPanel resourceType="quotations" recordId={q.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {signingId && (
        <section className="card">
          <h2>Sign quotation #{signingId}</h2>
          <form onSubmit={handleSign} className="form-grid">
            <label>
              Full name
              <input required value={signedBy} onChange={(e) => setSignedBy(e.target.value)} />
            </label>
            <label>Signature</label>
            <SignaturePad onChange={setSignature} />
            <div className="button-row">
              <button type="submit" disabled={busyId === signingId}>
                Confirm signature
              </button>
              <button
                type="button"
                onClick={() => {
                  setSigningId(null);
                  setSignature(null);
                  setSignedBy('');
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}

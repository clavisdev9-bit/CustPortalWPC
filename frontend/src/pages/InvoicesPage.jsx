import { Fragment, useEffect, useState } from 'react';
import { listInvoices, getOutstanding, createPaymentLink, uploadPaymentProof, getInvoicePdfBlob } from '../api/invoices';
import { downloadBlob } from '../utils/download';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import TableSkeleton from '../components/TableSkeleton';
import DocumentsPanel from '../components/DocumentsPanel';

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState([]);
  const [outstanding, setOutstanding] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [proofInvoiceId, setProofInvoiceId] = useState(null);
  const [proofAmount, setProofAmount] = useState('');
  const [proofMessage, setProofMessage] = useState(null);
  const [docsOpenId, setDocsOpenId] = useState(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [list, summary] = await Promise.all([listInvoices(), getOutstanding()]);
      setInvoices(list);
      setOutstanding(summary);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handlePay(id) {
    setBusyId(id);
    setError(null);
    try {
      const { url } = await createPaymentLink(id);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDownloadPdf(id, name) {
    setBusyId(id);
    setError(null);
    try {
      const blob = await getInvoicePdfBlob(id);
      downloadBlob(blob, `${name}.pdf`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleUploadProof(e) {
    e.preventDefault();
    const file = e.target.elements.file.files[0];
    if (!file) return;
    setBusyId(proofInvoiceId);
    setError(null);
    setProofMessage(null);
    try {
      await uploadPaymentProof(proofInvoiceId, file, proofAmount || undefined);
      setProofMessage('Proof submitted, pending review.');
      setProofInvoiceId(null);
      setProofAmount('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="invoices-page">
      <h1>Invoices</h1>
      {error && <p className="error">{error}</p>}
      {proofMessage && <p className="success">{proofMessage}</p>}

      {outstanding && (
        <section className="card">
          <h2>Outstanding Balance</h2>
          <p className="outstanding-amount">
            {outstanding.currency || ''} {outstanding.total.toLocaleString()}
          </p>
          <p className="muted">{outstanding.count} invoice(s) not fully paid</p>
        </section>
      )}

      <section className="card">
        {loading ? (
          <TableSkeleton cols={6} />
        ) : invoices.length === 0 ? (
          <EmptyState title="No invoices yet" hint="Issued invoices will appear here." />
        ) : (
          <table className="table--cards">
            <thead>
              <tr>
                <th>Number</th>
                <th>Due date</th>
                <th>Total</th>
                <th>Residual</th>
                <th>Payment status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <Fragment key={inv.id}>
                  <tr>
                    <td data-label="Number">{inv.name}</td>
                    <td data-label="Due date">{inv.invoice_date_due || '-'}</td>
                    <td data-label="Total">{inv.amount_total?.toLocaleString()}</td>
                    <td data-label="Residual">{inv.amount_residual?.toLocaleString()}</td>
                    <td data-label="Payment status"><StatusBadge status={inv.payment_state} /></td>
                    <td className="button-row">
                      <button disabled={busyId === inv.id} onClick={() => handleDownloadPdf(inv.id, inv.name)}>
                        PDF
                      </button>
                      {inv.payment_state !== 'paid' && (
                        <>
                          <button disabled={busyId === inv.id} onClick={() => handlePay(inv.id)}>
                            Pay
                          </button>
                          <button disabled={busyId === inv.id} onClick={() => setProofInvoiceId(inv.id)}>
                            Upload proof
                          </button>
                        </>
                      )}
                      <button type="button" onClick={() => setDocsOpenId(docsOpenId === inv.id ? null : inv.id)}>
                        Documents
                      </button>
                    </td>
                  </tr>
                  {docsOpenId === inv.id && (
                    <tr className="documents-row">
                      <td colSpan={6}>
                        <DocumentsPanel resourceType="invoices" recordId={inv.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {proofInvoiceId && (
        <section className="card">
          <h2>Upload payment proof for invoice #{proofInvoiceId}</h2>
          <form onSubmit={handleUploadProof} className="form-grid">
            <label>
              File
              <input type="file" name="file" required />
            </label>
            <label>
              Amount paid (optional)
              <input type="number" value={proofAmount} onChange={(e) => setProofAmount(e.target.value)} />
            </label>
            <div className="button-row">
              <button type="submit" disabled={busyId === proofInvoiceId}>
                Submit
              </button>
              <button type="button" onClick={() => setProofInvoiceId(null)}>
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}

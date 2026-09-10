import { Fragment, useEffect, useState } from 'react';
import { listOrders, reorder, getOrderPdfBlob } from '../api/orders';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import TableSkeleton from '../components/TableSkeleton';
import DocumentsPanel from '../components/DocumentsPanel';
import OrderDetailPanel from '../components/OrderDetailPanel';
import { downloadBlob } from '../utils/download';

export default function OrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [pdfBusyId, setPdfBusyId] = useState(null);
  const [message, setMessage] = useState(null);
  const [docsOpenId, setDocsOpenId] = useState(null);
  const [detailOpenId, setDetailOpenId] = useState(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setOrders(await listOrders());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleReorder(id) {
    setBusyId(id);
    setMessage(null);
    setError(null);
    try {
      const newOrder = await reorder(id);
      setMessage(`New draft quotation created: ${newOrder.name}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDownloadPdf(order) {
    setPdfBusyId(order.id);
    setError(null);
    try {
      const blob = await getOrderPdfBlob(order.id);
      downloadBlob(blob, `${order.name}.pdf`);
    } catch (err) {
      setError(err.message);
    } finally {
      setPdfBusyId(null);
    }
  }

  return (
    <div className="orders-page">
      <h1>Sales Orders</h1>
      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}
      <section className="card">
        {loading ? (
          <TableSkeleton cols={5} />
        ) : orders.length === 0 ? (
          <EmptyState title="No orders yet" hint="Your confirmed sales orders will appear here." />
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
              {orders.map((o) => (
                <Fragment key={o.id}>
                  <tr>
                    <td data-label="Number">{o.name}</td>
                    <td data-label="Date">{o.date_order ? new Date(o.date_order).toLocaleDateString() : '-'}</td>
                    <td data-label="Total">{o.amount_total?.toLocaleString()}</td>
                    <td data-label="State"><StatusBadge status={o.state} /></td>
                    <td className="button-row">
                      <button disabled={busyId === o.id} onClick={() => handleReorder(o.id)}>
                        Reorder
                      </button>
                      <button disabled={pdfBusyId === o.id} onClick={() => handleDownloadPdf(o)}>
                        {pdfBusyId === o.id ? 'Downloading...' : 'Download PDF'}
                      </button>
                      <button type="button" onClick={() => setDetailOpenId(detailOpenId === o.id ? null : o.id)}>
                        Details
                      </button>
                      <button type="button" onClick={() => setDocsOpenId(docsOpenId === o.id ? null : o.id)}>
                        Documents
                      </button>
                    </td>
                  </tr>
                  {detailOpenId === o.id && (
                    <tr className="documents-row">
                      <td colSpan={5}>
                        <OrderDetailPanel orderId={o.id} />
                      </td>
                    </tr>
                  )}
                  {docsOpenId === o.id && (
                    <tr className="documents-row">
                      <td colSpan={5}>
                        <DocumentsPanel resourceType="orders" recordId={o.id} />
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

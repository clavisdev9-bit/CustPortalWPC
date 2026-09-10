import { useEffect, useState } from 'react';
import { getSpendingTrend, getOrderVolumeTrend } from '../api/analytics';
import BarChart from '../components/BarChart';

const currencyFormat = (v) => v.toLocaleString(undefined, { maximumFractionDigits: 0 });

export default function AnalyticsPage() {
  const [spending, setSpending] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([getSpendingTrend(), getOrderVolumeTrend()])
      .then(([s, o]) => {
        setSpending(s);
        setOrders(o);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="analytics-page">
      <div className="page-head">
        <h1>Analytics</h1>
        <p className="muted">Your account activity over recent months.</p>
      </div>
      {error && <p className="error">{error}</p>}
      {loading ? (
        <>
          <section className="card">
            <h2>Spending by Month</h2>
            <span className="skeleton skeleton-chart" aria-hidden="true" />
          </section>
          <section className="card">
            <h2>Order Volume by Month</h2>
            <span className="skeleton skeleton-chart" aria-hidden="true" />
          </section>
        </>
      ) : (
        <>
          <section className="card">
            <h2>Spending by Month</h2>
            <p className="muted">Posted customer invoices, aggregated in Odoo (not summed client-side).</p>
            <BarChart data={spending} labelKey="month" valueKey="total" formatValue={currencyFormat} />
          </section>

          <section className="card">
            <h2>Order Volume by Month</h2>
            <p className="muted">Confirmed sales orders.</p>
            <BarChart data={orders} labelKey="month" valueKey="total" formatValue={currencyFormat} />
          </section>
        </>
      )}
    </div>
  );
}

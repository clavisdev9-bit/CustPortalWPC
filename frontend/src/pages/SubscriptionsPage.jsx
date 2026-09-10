import { useEffect, useState } from 'react';
import { listSubscriptions, requestRenew, requestUpgrade, requestDowngrade, requestClose } from '../api/subscriptions';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import TableSkeleton from '../components/TableSkeleton';

export default function SubscriptionsPage() {
  const [subs, setSubs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [actionId, setActionId] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setSubs(await listSubscriptions());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleRequest(action) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const requestFn = { renew: requestRenew, upgrade: requestUpgrade, downgrade: requestDowngrade, close: requestClose }[
      action
    ];
    try {
      await requestFn(actionId, note || undefined);
      setMessage(`${action[0].toUpperCase()}${action.slice(1)} request sent to the account team.`);
      setActionId(null);
      setNote('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="subscriptions-page">
      <h1>Contract &amp; Subscription</h1>
      <p className="muted">
        Renew/upgrade/downgrade/close are submitted as requests to the account team, not applied
        immediately -- recurring billing changes stay in Odoo (spec section 19).
      </p>
      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}

      <section className="card">
        {loading ? (
          <TableSkeleton cols={5} />
        ) : subs.length === 0 ? (
          <EmptyState title="No subscriptions yet" hint="Active contracts and subscriptions will appear here." />
        ) : (
          <table className="table--cards">
            <thead>
              <tr>
                <th>Name</th>
                <th>State</th>
                <th>Next invoice</th>
                <th>Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.id}>
                  <td data-label="Name">{s.name}</td>
                  <td data-label="State"><StatusBadge status={s.subscription_state || s.state} /></td>
                  <td data-label="Next invoice">{s.next_invoice_date || '-'}</td>
                  <td data-label="Total">{s.amount_total?.toLocaleString()}</td>
                  <td>
                    <button onClick={() => setActionId(s.id)}>Manage</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {actionId && (
        <section className="card">
          <h2>Manage subscription #{actionId}</h2>
          <label>
            Note (optional)
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="button-row">
            <button disabled={busy} onClick={() => handleRequest('renew')}>
              Request renewal
            </button>
            <button disabled={busy} onClick={() => handleRequest('upgrade')}>
              Request upgrade
            </button>
            <button disabled={busy} onClick={() => handleRequest('downgrade')}>
              Request downgrade
            </button>
            <button disabled={busy} onClick={() => handleRequest('close')}>
              Request closure
            </button>
            <button
              type="button"
              onClick={() => {
                setActionId(null);
                setNote('');
              }}
            >
              Cancel
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

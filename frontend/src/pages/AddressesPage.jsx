import { useEffect, useState } from 'react';
import { listAddresses } from '../api/addresses';

const m2o = (v) => (Array.isArray(v) ? v[1] : v) || null;

const TYPE_LABELS = {
  office: 'Office',
  invoice: 'Billing',
  delivery: 'Shipping',
  other: 'Other',
};

export default function AddressesPage() {
  const [addresses, setAddresses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    listAddresses()
      .then(setAddresses)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="addresses-page">
      <h1>Addresses</h1>
      {error && <p className="error">{error}</p>}
      {loading ? (
        <p>Loading...</p>
      ) : addresses.length === 0 ? (
        <section className="card">
          <p className="muted">No addresses on file.</p>
        </section>
      ) : (
        addresses.map((a) => {
          const addressLine = [a.street, a.street2].filter(Boolean).join(', ');
          const cityLine = [a.city, m2o(a.state_id), a.zip].filter(Boolean).join(' ');
          return (
            <section key={a.id} className="card">
              <h2>{TYPE_LABELS[a.type] || a.name || 'Address'}</h2>
              {a.name && a.type !== 'office' && <p className="muted">{a.name}</p>}
              <div className="info-grid">
                <div className="info-field info-field--wide">
                  <dt>Address</dt>
                  <dd>
                    {addressLine && <div>{addressLine}</div>}
                    {cityLine && <div>{cityLine}</div>}
                    {m2o(a.country_id) && <div>{m2o(a.country_id)}</div>}
                    {!addressLine && !cityLine && !m2o(a.country_id) && '-'}
                  </dd>
                </div>
                <div className="info-field">
                  <dt>Phone</dt>
                  <dd>{a.phone || '-'}</dd>
                </div>
                <div className="info-field">
                  <dt>Email</dt>
                  <dd>{a.email || '-'}</dd>
                </div>
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

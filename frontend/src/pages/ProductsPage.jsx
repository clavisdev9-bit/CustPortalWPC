import { useEffect, useState } from 'react';
import { listProducts, getPurchaseHistory, getReorderSuggestions } from '../api/products';

export default function ProductsPage() {
  const [products, setProducts] = useState([]);
  const [history, setHistory] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([listProducts(), getPurchaseHistory(), getReorderSuggestions()])
      .then(([p, h, s]) => {
        setProducts(p);
        setHistory(h);
        setSuggestions(s);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="products-page">
      <h1>Products</h1>
      {error && <p className="error">{error}</p>}

      <section className="card">
        <h2>Reorder Suggestions</h2>
        <p className="muted">
          Products you&apos;ve ordered before, ranked by how often -- not a similarity engine, just
          your own purchase history.
        </p>
        {loading ? (
          <p>Loading...</p>
        ) : suggestions.length === 0 ? (
          <p className="muted">No purchase history yet to base suggestions on.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Times ordered</th>
                <th>Total quantity</th>
              </tr>
            </thead>
            <tbody>
              {suggestions.map((s) => (
                <tr key={s.product_id}>
                  <td>{s.product_name}</td>
                  <td>{s.order_count}</td>
                  <td>{s.total_qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <details className="card card--collapsible" open>
        <summary className="card__summary">
          <span className="card__summary-title">Catalog</span>
          {!loading && <span className="card__summary-count">{products.length} item{products.length === 1 ? '' : 's'}</span>}
        </summary>
        <div className="card__body">
          <p className="muted">
            Prices shown are Odoo&apos;s standard list price -- customer-specific pricelist rates are a
            follow-up once verified against the target Odoo version.
          </p>
          {loading ? (
            <p>Loading...</p>
          ) : products.length === 0 ? (
            <p className="muted">No products available.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Price</th>
                  <th>Available qty</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id}>
                    <td>{p.default_code || '-'}</td>
                    <td>{p.name}</td>
                    <td>{p.list_price?.toLocaleString()}</td>
                    <td>{p.qty_available}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </details>

      <details className="card card--collapsible">
        <summary className="card__summary">
          <span className="card__summary-title">Purchase History</span>
          {!loading && <span className="card__summary-count">{history.length} line{history.length === 1 ? '' : 's'}</span>}
        </summary>
        <div className="card__body">
          {loading ? (
            <p>Loading...</p>
          ) : history.length === 0 ? (
            <p className="muted">No past purchases yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Product</th>
                  <th>Qty</th>
                  <th>Unit price</th>
                </tr>
              </thead>
              <tbody>
                {history.map((line) => (
                  <tr key={line.id}>
                    <td>{line.order_id?.[1] || '-'}</td>
                    <td>{line.product_id?.[1] || '-'}</td>
                    <td>{line.product_uom_qty}</td>
                    <td>{line.price_unit?.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </details>
    </div>
  );
}

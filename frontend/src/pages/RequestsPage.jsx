import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listRequests, createRequest } from '../api/requests';
import { listProducts } from '../api/products';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import TableSkeleton from '../components/TableSkeleton';
import ProductCombobox from '../components/ProductCombobox';

function describeItems(r) {
  if (r.type !== 'request_quotation' || !Array.isArray(r.payload?.lines)) return null;
  return r.payload.lines;
}

export default function RequestsPage() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [type, setType] = useState('request_quotation');

  const [products, setProducts] = useState([]);
  const [productsError, setProductsError] = useState(null);
  const [productsLoading, setProductsLoading] = useState(true);
  const [pickProduct, setPickProduct] = useState(null); // objek produk, bukan id string
  const [pickQty, setPickQty] = useState('1');
  const [lines, setLines] = useState([]);
  const [quotationNote, setQuotationNote] = useState('');

  const [productNote, setProductNote] = useState('');

  async function refresh() {
    setLoading(true);
    try {
      setRequests(await listRequests());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    listProducts()
      .then(setProducts)
      .catch((err) => setProductsError(err.message))
      .finally(() => setProductsLoading(false));
  }, []);

  const existingIds = useMemo(() => new Set(lines.map((l) => l.product_id)), [lines]);

  const estimatedTotal = useMemo(
    () => lines.reduce((sum, l) => sum + (Number(l.qty) || 0) * (Number(l.list_price) || 0), 0),
    [lines]
  );

  function handleAddLine() {
    const qty = Number(pickQty);
    // INV-1: hanya objek produk dari katalog yang boleh jadi baris. Tidak ada jalur di mana
    // ketikan bebas berakhir sebagai sale.order.line.
    if (!pickProduct || !(qty > 0)) return;
    setLines((prev) => {
      const existing = prev.find((l) => l.product_id === pickProduct.id);
      if (existing) {
        // D-6 membuat qty baris bisa jadi string (diketik langsung di tabel) -- `+` di sini
        // tanpa Number() akan menyambung teks ("2" + 3 -> "23") alih-alih menjumlah.
        return prev.map((l) => (l.product_id === pickProduct.id ? { ...l, qty: (Number(l.qty) || 0) + qty } : l));
      }
      return [
        ...prev,
        {
          product_id: pickProduct.id,
          product_name: pickProduct.name,
          default_code: pickProduct.default_code || undefined,
          qty,
          list_price: pickProduct.list_price || 0,
        },
      ];
    });
    setPickProduct(null);
    setPickQty('1');
  }

  function handleRequestUncataloged(q) {
    // Portal tidak boleh membuat product.product di Odoo. Yang bisa dilakukan di sini persis
    // jalur yang sudah ada: catat permintaannya sebagai request_product supaya Sales menindak.
    setType('request_product');
    setProductNote((prev) => (prev.trim() ? prev : q));
    setPickProduct(null);
  }

  function handleRemoveLine(productId) {
    setLines((prev) => prev.filter((l) => l.product_id !== productId));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (type === 'request_quotation') {
        await createRequest({
          type,
          payload: {
            lines: lines.map(({ product_id, product_name, default_code, qty }) => ({
              product_id,
              product_name,
              default_code,
              qty: Number(qty),
            })),
            note: quotationNote.trim() || undefined,
          },
        });
        setLines([]);
        setQuotationNote('');
      } else {
        await createRequest({ type, payload: { note: productNote } });
        setProductNote('');
      }
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit =
    type === 'request_quotation'
      ? lines.length > 0 && lines.every((l) => Number(l.qty) > 0)
      : productNote.trim().length > 0;

  return (
    <div className="requests-page">
      <h1>Product / Quotation Requests</h1>
      <p className="muted">
        Requesting a quotation creates a real draft quotation in Odoo from the products and
        quantities you pick below -- you can review it under Quotations once submitted, and Sales
        will finalize pricing from there. Requesting a product not in the catalog just logs your
        ask in the portal and notifies our team, since there&apos;s no catalog item yet to build a
        quotation from -- Sales will follow up manually.
      </p>
      {error && <p className="error">{error}</p>}

      <section className="card">
        <h2>New request</h2>
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value)} style={{ maxWidth: 300 }}>
            <option value="request_quotation">Request a quotation (sales order)</option>
            <option value="request_product">Request a product not in the catalog</option>
          </select>
        </label>

        {type === 'request_quotation' ? (
          <form onSubmit={handleSubmit} className="form-grid" style={{ maxWidth: 'none', marginTop: 'var(--s-4)' }}>
            {productsError && <p className="error">Could not load product catalog: {productsError}</p>}

            <div className="line-item-picker">
              <label style={{ flex: '3 1 380px' }} htmlFor="quotation-product">
                Product
                <ProductCombobox
                  inputId="quotation-product"
                  products={products}
                  value={pickProduct}
                  onChange={setPickProduct}
                  onRequestUncataloged={handleRequestUncataloged}
                  existingIds={existingIds}
                  loading={productsLoading}
                  disabled={Boolean(productsError)}
                />
              </label>
              <label style={{ flex: '0 1 110px' }}>
                Qty
                <input
                  type="number"
                  min="0.01"
                  step="any"
                  value={pickQty}
                  onChange={(e) => setPickQty(e.target.value)}
                  // M-5: tanpa ini, Enter di sini mengirim seluruh request quotation lebih awal.
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddLine(); } }}
                />
              </label>
              <button type="button" onClick={handleAddLine} disabled={!pickProduct || !(Number(pickQty) > 0)}>
                Add line
              </button>
            </div>

            {lines.length === 0 ? (
              <p className="muted">No line items added yet. Add at least one product above.</p>
            ) : (
              <>
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Qty</th>
                      <th>Est. unit price</th>
                      <th>Est. subtotal</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.product_id}>
                        <td>
                          {l.default_code ? `[${l.default_code}] ` : ''}
                          {l.product_name}
                        </td>
                        <td data-label="Qty" className="num">
                          <input
                            type="number" min="0.01" step="any" className="line-qty-input"
                            value={l.qty}
                            onChange={(e) => setLines((prev) => prev.map((x) =>
                              x.product_id === l.product_id ? { ...x, qty: e.target.value } : x))}
                          />
                        </td>
                        <td className="num">{l.list_price?.toLocaleString()}</td>
                        <td className="num">{((Number(l.qty) || 0) * (l.list_price || 0)).toLocaleString()}</td>
                        <td>
                          <button type="button" onClick={() => handleRemoveLine(l.product_id)}>
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="muted">
                  Estimated total: <span className="num">{estimatedTotal.toLocaleString()}</span> --
                  based on catalog list price. The draft quotation Odoo creates may price these
                  lines differently (your pricelist, taxes, discounts), and Sales can still adjust
                  it before sending you the final version.
                </p>
              </>
            )}

            <label>
              Note to sales (optional)
              <input
                value={quotationNote}
                onChange={(e) => setQuotationNote(e.target.value)}
                placeholder="Delivery timing, special requirements, etc."
              />
            </label>

            <button type="submit" disabled={submitting || !canSubmit}>
              {submitting ? 'Submitting...' : 'Submit quotation request'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmit} className="form-grid" style={{ marginTop: 'var(--s-4)' }}>
            <label>
              What product are you looking for?
              <input
                required
                value={productNote}
                onChange={(e) => setProductNote(e.target.value)}
                placeholder="Describe the product, spec, or use case"
              />
            </label>
            <button type="submit" disabled={submitting || !canSubmit}>
              {submitting ? 'Submitting...' : 'Submit request'}
            </button>
          </form>
        )}
      </section>

      <section className="card">
        <h2>My requests</h2>
        {loading ? (
          <TableSkeleton cols={6} />
        ) : requests.length === 0 ? (
          <EmptyState title="No requests yet" hint="Quotation and product requests you submit will be listed here." />
        ) : (
          <table className="table--cards">
            <thead>
              <tr>
                <th>Type</th>
                <th>Items</th>
                <th>Note</th>
                <th>Odoo quotation</th>
                <th>Status</th>
                <th>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => {
                const items = describeItems(r);
                return (
                  <tr key={r.id}>
                    <td data-label="Type">{r.type === 'request_quotation' ? 'Quotation' : 'Product'}</td>
                    <td data-label="Items">
                      {items ? (
                        <ul className="request-items-list">
                          {items.map((l) => (
                            <li key={l.product_id}>
                              {l.product_name} x{l.qty}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td data-label="Note">{r.payload?.note || '-'}</td>
                    <td data-label="Odoo quotation">
                      {r.payload?.odoo_order_name ? (
                        <Link to="/quotations">{r.payload.odoo_order_name}</Link>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td data-label="Status"><StatusBadge status={r.status} /></td>
                    <td data-label="Submitted">{new Date(r.created_at).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

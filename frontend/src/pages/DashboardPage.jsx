import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getDashboardSummary } from '../api/dashboard';

const ICONS = {
  quotations: <><path d="M20.6 8.4L12 17l-8.6-8.6a2 2 0 0 1 0-2.8l1.6-1.6h12l1.6 1.6a2 2 0 0 1 0 2.8z" /><circle cx="7.5" cy="7.5" r="1.2" /></>,
  orders: <><path d="M6 2l1.5 3h9L18 2" /><path d="M4 5h16l-1.5 13a2 2 0 0 1-2 1.8H7.5a2 2 0 0 1-2-1.8z" /></>,
  invoices: <><path d="M6 2h9l4 4v16l-3-2-2 2-2-2-2 2-2-2-2 2V4a2 2 0 0 1 2-2z" /><path d="M9 8h6M9 12h6" /></>,
  tickets: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  requests: <><path d="M14 3v5h5" /><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M12 11v6M9 14h6" /></>,
  deliveries: <><path d="M1 3h13v13H1z" /><path d="M14 8h5l3 3v5h-8z" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="19" r="2" /></>,
  rma: <><path d="M3 12a9 9 0 1 1 3 6.7" /><path d="M3 21v-5h5" /></>,
  warranty: <><path d="M12 3l8 3v6c0 4.5-3.2 7.7-8 9-4.8-1.3-8-4.5-8-9V6z" /><path d="M9 12l2 2 4-4" /></>,
  subscriptions: <><path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></>,
  documents: <><path d="M14 3v5h5" /><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /></>,
};

function Icon({ name }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

// Shortcuts to modules not already surfaced as a KPI -- pure navigation, no numbers, so it's
// safe to render before/without the summary having loaded.
const SHORTCUTS = [
  { key: 'requests', to: '/requests', label: 'Request Quotation', hint: 'Ask for a new quote' },
  { key: 'deliveries', to: '/deliveries', label: 'Deliveries', hint: 'Track shipments' },
  { key: 'rma', to: '/rma', label: 'RMA / Return', hint: 'Start a return' },
  { key: 'warranty', to: '/warranty', label: 'Warranty', hint: 'Check coverage' },
  { key: 'subscriptions', to: '/subscriptions', label: 'Subscriptions', hint: 'Manage contracts' },
  { key: 'documents', to: '/documents', label: 'Documents', hint: 'Shared files' },
];

export default function DashboardPage() {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    // BUG-25/BUG-23: a platform admin operates the SaaS itself, not a customer org -- it never has
    // an odoo_companies mapping (by design) and this dashboard is customer-facing, so calling
    // getDashboardSummary() for one only ever produces a 400 no_company_selected. Same pattern as
    // AssistantAdminPage.jsx's early-return: skip the call entirely rather than fetch-then-fail.
    if (user?.is_platform_admin) return;
    getDashboardSummary()
      .then(setSummary)
      .catch((err) => setError(err));
  }, [user?.is_platform_admin]);

  if (user?.is_platform_admin) {
    return (
      <div className="dashboard">
        <div className="page-head">
          <h1>Welcome, {user?.name}</h1>
        </div>
        <div className="card">
          <p>
            Anda login sebagai <b>platform admin</b> — dashboard ini menampilkan data pelanggan
            (quotation, order, invoice, dst.) yang tidak berlaku untuk akun platform admin.
          </p>
          <p className="muted">
            Untuk mengelola koneksi Odoo atau menyinkronkan user, buka{' '}
            <Link to="/settings/odoo-connection">Setting &rsaquo; Koneksi Odoo</Link>.
          </p>
        </div>
      </div>
    );
  }

  const kpis = summary && [
    { key: 'quotations', tone: 'primary', value: summary.quotations, label: 'Quotations', to: '/quotations' },
    { key: 'orders', tone: 'accent', value: summary.orders, label: 'Orders', to: '/orders' },
    { key: 'invoices', tone: 'warning', value: summary.invoices, label: 'Invoices', to: '/invoices' },
    {
      key: 'tickets',
      tone: 'info',
      value: summary.tickets ?? '—',
      label: summary.tickets === null ? 'Tickets (no access)' : 'Tickets',
      to: summary.tickets === null ? null : '/tickets',
    },
  ];

  return (
    <div className="dashboard">
      <div className="page-head">
        <h1>Welcome, {user?.name}</h1>
        <p className="muted">Roles: {user?.roles?.length ? user.roles.join(', ') : 'No role assigned'}</p>
      </div>

      {error && (
        <p className="error">
          {error.code === 'no_company_selected'
            ? 'Akun Anda belum terhubung ke company mana pun. Hubungi admin untuk memperbaiki ini.'
            : error.message}
        </p>
      )}

      <div className="kpis">
        <div className="kpi-grid">
          {kpis
            ? kpis.map((kpi) => {
                const body = (
                  <>
                    <div className="kpi__top">
                      <span className="kpi__icon"><Icon name={kpi.key} /></span>
                    </div>
                    <div className="kpi__value">{kpi.value}</div>
                    <div className="kpi__label">{kpi.label}</div>
                  </>
                );
                return kpi.to ? (
                  <Link key={kpi.key} to={kpi.to} className="kpi" data-tone={kpi.tone}>{body}</Link>
                ) : (
                  <article key={kpi.key} className="kpi" data-tone={kpi.tone}>{body}</article>
                );
              })
            : Array.from({ length: 4 }).map((_, i) => (
                <div className="kpi skeleton-kpi" key={i} aria-hidden="true">
                  <span className="skeleton" />
                  <span className="skeleton" />
                  <span className="skeleton" />
                </div>
              ))}
        </div>
      </div>

      {summary && (
        <div className="card">
          <h2>Outstanding Balance</h2>
          <p className="outstanding-amount">
            {summary.outstanding.currency || ''} {summary.outstanding.total.toLocaleString()}
          </p>
          <p className="muted">Total across all invoices not fully paid.</p>
          <Link to="/invoices">View invoices →</Link>
        </div>
      )}

      <div className="card">
        <h2>Quick actions</h2>
        <div className="shortcut-grid">
          {SHORTCUTS.map((shortcut) => (
            <Link key={shortcut.key} to={shortcut.to} className="shortcut-card">
              <span className="shortcut-card__icon"><Icon name={shortcut.key} /></span>
              <span className="shortcut-card__text">
                <span className="shortcut-card__label">{shortcut.label}</span>
                <span className="shortcut-card__hint">{shortcut.hint}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

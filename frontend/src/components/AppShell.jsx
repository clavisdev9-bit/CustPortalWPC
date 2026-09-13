import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import CompanySwitcher from './CompanySwitcher';
import NotificationBell from './NotificationBell';
import ThemeToggle from './ThemeToggle';
import AssistantWidget from './Assistant/AssistantWidget';
import { listCapabilities } from '../api/capabilities';

// Mirrors the menu in spec section 31. Only the items that have a real API behind them are
// wired up -- the rest render as disabled so the intended information architecture is visible
// without pretending features that don't exist yet are live.
const NAV_SECTIONS = [
  { label: 'Dashboard', to: '/', end: true },
  {
    key: 'my-account',
    label: 'My Account',
    children: [
      { label: 'User Management', to: '/users' },
      { label: 'Security', to: '/security' },
      { label: 'Company Profile', to: '/company-profile' },
      { label: 'Addresses', to: '/addresses' },
      { label: 'Contacts / PIC', to: '/contacts' },
    ],
  },
  {
    label: 'Sales',
    children: [
      { label: 'Quotations', to: '/quotations' },
      { label: 'Sales Orders', to: '/orders' },
      { label: 'Request Quotation', to: '/requests' },
    ],
  },
  {
    label: 'Finance',
    children: [
      { label: 'Invoices', to: '/invoices' },
      // Outstanding balance isn't its own record type in Odoo -- it's a live aggregate over the
      // customer's own unpaid invoices, so it's shown as a card at the top of Invoices itself
      // (InvoicesPage.jsx) rather than a second page duplicating the same data.
      { label: 'Outstanding', to: '/invoices' },
    ],
  },
  {
    label: 'Delivery',
    children: [
      { label: 'Deliveries', to: '/deliveries' },
      // Docs/CR/prompt-shipment-tracking-interactive-prototype_1.md: clickable prototype over an
      // in-memory mock dataset (no Odoo/backend behind it yet) -- no `feature` gate, since there's
      // no capability to check against.
      { label: 'Shipment Tracking', to: '/shipment-tracking' },
      // Docs/CR/customer_portal_vessel_schedule.md, Fase 0-P: same situation as Shipment Tracking
      // above -- in-memory mock only, no `feature` gate (the `freight_schedule` Odoo addon this
      // would eventually read from doesn't exist yet, so there's no capability to check).
      { label: 'Vessel Schedule', to: '/vessel-schedule' },
    ],
  },
  {
    // Freight-forwarding blueprint attachment (§6 arsitektur: Shipment Data / Sea-Air, Vessel-
    // Flight schedule, Capacity/LCL). Added as its own group rather than folded into "Delivery"
    // so the existing Delivery menu stays exactly as-is; the two prototype pages below are also
    // still reachable from Delivery, this just gives them a dedicated, purpose-named home too.
    label: 'Portal WPC',
    children: [
      { label: 'Shipment Tracking', to: '/shipment-tracking' },
      { label: 'Vessel Schedule', to: '/vessel-schedule' },
      { label: 'LCL Capacity', to: '/lcl-capacity' },
    ],
  },
  {
    label: 'After Sales',
    children: [
      { label: 'Warranty', to: '/warranty' },
      // A "Complaint" isn't a distinct Odoo model -- it's a helpdesk.ticket like any other, so it
      // routes straight into Tickets rather than a parallel, empty complaints inbox.
      { label: 'Complaint', to: '/tickets', feature: 'helpdesk' },
      { label: 'Schedule Maintenance', to: '/maintenance', feature: 'maintenance' },
      // "My Equipment" (CR customer_population_installed_base.md D-6/section 12): placed here,
      // not a new top-level group, because customers reach for it exactly when they already need
      // service or parts -- this group is where they're already looking.
      { label: 'My Equipment', to: '/equipment', feature: 'equipment' },
      { label: 'Due Replacements', to: '/equipment/due', feature: 'equipment' },
    ],
  },
  // Per-record document panels still live on each item's page (DocumentsPanel in Quotations/Orders/
  // Invoices/Deliveries). This top-level link is the shared-documents inbox (Option B): files staff
  // share directly to a customer, plus the staff-side share form for the "Staff (Internal)" role.
  { label: 'Documents', to: '/documents' },
  { label: 'Products', to: '/products' },
  { label: 'Analytics', to: '/analytics' },
  { label: 'Contract & Subscription', to: '/subscriptions', feature: 'subscriptions' },
  {
    label: 'Communication',
    children: [
      { label: 'Tickets', to: '/tickets', feature: 'helpdesk' },
      // Replies live inside each ticket's own thread (TicketsPage.jsx), not a separate inbox.
      { label: 'Messages', to: '/tickets', feature: 'helpdesk' },
      // Not a route -- opens the bell dropdown that's already in the topbar on every page (see
      // the onClick special-case below and the notificationsOpen state it controls).
      { label: 'Notifications' },
    ],
  },
];

// Ditambahkan HANYA untuk platform admin. Bukan bagian dari menu pelanggan di atas: konfigurasi
// asisten berlaku lintas pelanggan, jadi ia urusan operator platform (requirePlatformAdmin di
// backend), bukan Customer Admin.
const PLATFORM_ADMIN_SECTIONS = [{ label: 'Asisten Portal', to: '/admin/assistant' }];

// Docs/CR/air_schedule.md D-4/AS-7: Air Cargo Schedule is a STAFF console, not a customer feature
// -- it deliberately does NOT live inside the Delivery group (or any other customer nav group)
// alongside Deliveries/Shipment Tracking/Vessel Schedule, because that would suggest customers can
// see it too. Rendered as its own section, gated the same way SharePanel is gated in
// DocumentsPage.jsx (`canShare`): 'Staff (Internal)' role or platform admin, nothing else.
const STAFF_SECTIONS = [{ label: 'Air Cargo Schedule', to: '/air-schedule' }];

// Line icons (stroke = currentColor). Keyed by nav label; anything unmapped gets a neutral dot.
const ICON_PATHS = {
  Dashboard: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  'User Management': <><circle cx="9" cy="8" r="3.5" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 5a3.5 3.5 0 0 1 0 7M18 20a6 6 0 0 0-3-5.2" /></>,
  Security: <><path d="M12 3l8 3v6c0 4.5-3.2 7.7-8 9-4.8-1.3-8-4.5-8-9V6z" /></>,
  'Company Profile': <><path d="M3 21h18M5 21V7l7-4 7 4v14" /><path d="M9 21v-6h6v6" /><path d="M9 9h1M14 9h1M9 12h1M14 12h1" /></>,
  Addresses: <><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></>,
  'Contacts / PIC': <><rect x="4" y="3" width="16" height="18" rx="2" /><circle cx="12" cy="10" r="2.5" /><path d="M8 17a4 4 0 0 1 8 0" /></>,
  Quotations: <><path d="M20.6 8.4L12 17l-8.6-8.6a2 2 0 0 1 0-2.8l1.6-1.6h12l1.6 1.6a2 2 0 0 1 0 2.8z" /><circle cx="7.5" cy="7.5" r="1.2" /></>,
  'Sales Orders': <><path d="M6 2l1.5 3h9L18 2" /><path d="M4 5h16l-1.5 13a2 2 0 0 1-2 1.8H7.5a2 2 0 0 1-2-1.8z" /></>,
  'Request Quotation': <><path d="M14 3v5h5" /><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M12 11v6M9 14h6" /></>,
  Invoices: <><path d="M6 2h9l4 4v16l-3-2-2 2-2-2-2 2-2-2-2 2V4a2 2 0 0 1 2-2z" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
  Outstanding: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>,
  Deliveries: <><path d="M1 3h13v13H1z" /><path d="M14 8h5l3 3v5h-8z" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="19" r="2" /></>,
  'Shipment Tracking': <><path d="M2 12h5l2-6h6l2 6h5" /><path d="M4 12v5h16v-5" /><circle cx="8" cy="19" r="1.6" /><circle cx="16" cy="19" r="1.6" /></>,
  'Vessel Schedule': <><path d="M3 21c2-1 4-1 6 0s4 1 6 0 4-1 6 0" /><path d="M5 17l1-8h12l1 8" /><path d="M9 9V4h4l3 5" /></>,
  'LCL Capacity': <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 15h11M14 15v6M3 3l11 12" /></>,
  Warranty: <><path d="M12 3l8 3v6c0 4.5-3.2 7.7-8 9-4.8-1.3-8-4.5-8-9V6z" /><path d="M9 12l2 2 4-4" /></>,
  Complaint: <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /><path d="M12 7v4M12 14h.01" /></>,
  'Schedule Maintenance': <><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /><path d="M8 14h1M12 14h1M16 14h1M8 17h1M12 17h1" /></>,
  'My Equipment': <><rect x="3" y="11" width="6" height="10" rx="1" /><rect x="15" y="11" width="6" height="10" rx="1" /><path d="M9 21v-6h6v6" /><path d="M7 11V7a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v4" /><path d="M12 5V3" /></>,
  'Due Replacements': <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></>,
  Documents: <><path d="M14 3v5h5" /><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /></>,
  Products: <><path d="M12 2l9 5v10l-9 5-9-5V7z" /><path d="M3 7l9 5 9-5M12 12v10" /></>,
  Analytics: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  'Contract & Subscription': <><path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></>,
  Tickets: <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></>,
  Messages: <><path d="M4 4h16v12H8l-4 4z" /></>,
  Notifications: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>,
  'Asisten Portal': <><path d="M4 4h16v12H8l-4 4z" /><path d="M9 10h.01M12 10h.01M15 10h.01" /></>,
  'Air Cargo Schedule': <><path d="M2.5 19l19-7-19-7 4 7z" /><path d="M6.5 12H21" /></>,
  Setting: <><line x1="4" y1="6" x2="20" y2="6" /><circle cx="9" cy="6" r="2" /><line x1="4" y1="12" x2="20" y2="12" /><circle cx="15" cy="12" r="2" /><line x1="4" y1="18" x2="20" y2="18" /><circle cx="9" cy="18" r="2" /></>,
  'Konfigurasi Provider AI': <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 9h8M8 13h5" /><circle cx="17" cy="15.5" r="1.4" /></>,
};

function NavIcon({ label }) {
  const paths = ICON_PATHS[label];
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths || <circle cx="12" cy="12" r="2.5" />}
    </svg>
  );
}

// Menu tanpa `feature` tidak pernah tersembunyi, dan selama kapabilitas belum termuat tidak ada
// yang tersembunyi -- hanya `false` yang eksplisit menyembunyikan.
function hasFeature(capabilities, feature) {
  return !feature || !capabilities || capabilities[feature] !== false;
}

function linkClassName({ isActive }) {
  return `nav-link${isActive ? ' active' : ''}`;
}

function childLinkClassName({ isActive }) {
  return `nav-link nav-link--child${isActive ? ' active' : ''}`;
}

function initials(name) {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || '')
    .join('')
    .toUpperCase();
}

export default function AppShell() {
  const { user, logout } = useAuth();
  // Same gate as SharePanel's `canShare` in DocumentsPage.jsx -- deliberately role-based, not
  // `feature`-based: `feature` only hides menus whose Odoo module isn't installed, it says nothing
  // about who is allowed to use them (D-4/AS-7, Docs/CR/air_schedule.md).
  const isStaff = !!user?.is_platform_admin
    || (Array.isArray(user?.roles) && user.roles.includes('Staff (Internal)'));
  const [navOpen, setNavOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('portal-nav-collapsed') === '1';
    } catch {
      return false;
    }
  });
  const location = useLocation();

  // BUG-31: modul Odoo yang terpasang di koneksi perusahaan aktif. `null` = belum termuat, yang
  // sengaja diperlakukan sama dengan "semua tersedia" -- menu tidak boleh berkedip hilang lalu
  // muncul lagi pada tiap pemuatan halaman, dan menyembunyikan menu yang sebenarnya ADA jauh
  // lebih merugikan daripada menampilkan menu yang ternyata tidak ada (yang toh kini dijawab
  // pesan `feature_unavailable` yang jelas, bukan fault XML-RPC mentah).
  const [capabilities, setCapabilities] = useState(null);
  // Dinaikkan tiap kali company berpindah (CompanySwitcher) -- company lain bisa berarti koneksi
  // Odoo lain dengan modul terpasang yang berbeda.
  const [capabilitiesEpoch, setCapabilitiesEpoch] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listCapabilities()
      .then((c) => { if (!cancelled) setCapabilities(c); })
      .catch(() => { /* endpoint ini tidak pernah gagal; kalaupun iya, nav tampil utuh */ });
    return () => { cancelled = true; };
  }, [capabilitiesEpoch]);

  // Close the mobile drawer whenever the route changes...
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  // ...or when Escape is pressed.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') setNavOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The hamburger does double duty: on phones it opens/closes the off-canvas drawer; on wider
  // screens it collapses the sidebar to an icon-only rail (the choice is remembered across visits).
  function toggleNav() {
    if (window.matchMedia('(max-width: 900px)').matches) {
      setNavOpen((open) => !open);
    } else {
      setCollapsed((value) => {
        const next = !value;
        try {
          localStorage.setItem('portal-nav-collapsed', next ? '1' : '0');
        } catch {
          /* ignore private-mode storage errors */
        }
        return next;
      });
    }
  }

  return (
    <div className={`app-shell${collapsed ? ' app-shell--collapsed' : ''}`}>
      {navOpen && <div className="sidebar-backdrop" aria-hidden="true" onClick={() => setNavOpen(false)} />}
      <aside className={`sidebar${navOpen ? ' sidebar--open' : ''}`} id="app-sidebar">
        <div className="sidebar-brand">
          <span className="logo" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-6 9 6v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <path d="M9 21V12h6v9" />
            </svg>
          </span>
          <span>
            <b>Customer Portal</b>
            <small>Self-service</small>
          </span>
        </div>
        <nav onClick={() => setNavOpen(false)}>
          {[...NAV_SECTIONS, ...(isStaff ? STAFF_SECTIONS : []), ...(user?.is_platform_admin ? PLATFORM_ADMIN_SECTIONS : [])]
            .map((section) => {
              // "Setting > Koneksi Odoo" and "Konfigurasi Provider AI" are both platform-admin
              // only (backend: requirePlatformAdmin on /admin/odoo-connections and
              // /admin/assistant/provider-configs) -- injected into My Account's children instead
              // of a static NAV_SECTIONS entry so non-admin customers never see either, cosmetic-
              // only like the is_platform_admin check on each page itself. Matched by `key`, not
              // `label`, so a future copy/i18n change to the visible label can't silently break
              // this gate. Kept as two separate links (not nested under "Setting") so Odoo
              // connection config and AI provider config stay visibly distinct, per CR.
              if (section.key === 'my-account' && user?.is_platform_admin) {
                return {
                  ...section,
                  children: [
                    ...section.children,
                    { label: 'Setting', to: '/settings/odoo-connection' },
                    { label: 'Konfigurasi Provider AI', to: '/settings/ai-provider' },
                  ],
                };
              }
              return section;
            })
            // BUG-31: buang menu yang modul Odoo-nya memang tidak terpasang. Hanya `false` yang
            // menyembunyikan -- `undefined` (belum termuat, atau item tanpa `feature`) selalu
            // tampil. Grup yang seluruh anaknya tersaring ikut hilang, supaya tidak menyisakan
            // judul grup kosong yang menggantung.
            .map((section) => (section.children
              ? { ...section, children: section.children.filter((c) => hasFeature(capabilities, c.feature)) }
              : section))
            .filter((section) => hasFeature(capabilities, section.feature)
              && !(section.children && section.children.length === 0))
            .map((section) => (
            <div key={section.label} className="nav-section">
              {section.to ? (
                <NavLink to={section.to} end={section.end} className={linkClassName} title={section.label}>
                  <NavIcon label={section.label} />
                  <span className="nav-link__text">{section.label}</span>
                </NavLink>
              ) : (
                <div className="nav-group-label">
                  {section.label}
                  {section.note && <span className="phase-badge">{section.note}</span>}
                </div>
              )}
              {section.children?.map((child) =>
                child.to ? (
                  <NavLink key={child.label} to={child.to} className={childLinkClassName} title={child.label}>
                    <NavIcon label={child.label} />
                    <span className="nav-link__text">{child.label}</span>
                    {child.note && <span className="phase-badge">{child.note}</span>}
                  </NavLink>
                ) : child.label === 'Notifications' ? (
                  <button
                    key={child.label}
                    type="button"
                    className="nav-link nav-link--child"
                    title={child.label}
                    onClick={() => setNotificationsOpen(true)}
                  >
                    <NavIcon label={child.label} />
                    <span className="nav-link__text">{child.label}</span>
                  </button>
                ) : (
                  <div key={child.label} className="nav-link nav-link--child nav-link--disabled" title={child.label}>
                    <NavIcon label={child.label} />
                    <span className="nav-link__text">{child.label}</span>
                    {child.note && <span className="phase-badge">{child.note}</span>}
                  </div>
                )
              )}
            </div>
          ))}
        </nav>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="nav-toggle"
              type="button"
              aria-label="Toggle navigation menu"
              aria-controls="app-sidebar"
              aria-expanded={navOpen}
              onClick={toggleNav}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M3 6h18M3 12h18M3 18h18" />
              </svg>
            </button>
            <CompanySwitcher onCompanyChange={() => setCapabilitiesEpoch((n) => n + 1)} />
          </div>
          <div className="user-menu">
            <ThemeToggle />
            <NotificationBell open={notificationsOpen} onOpenChange={setNotificationsOpen} />
            <div className="avatar">
              <span className="avatar__pic" aria-hidden="true">{initials(user?.name)}</span>
              <span className="avatar__name">{user?.name}</span>
            </div>
            <button onClick={logout}>Logout</button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
      <AssistantWidget />
    </div>
  );
}

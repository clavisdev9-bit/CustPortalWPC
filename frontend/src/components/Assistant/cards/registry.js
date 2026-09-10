import * as invoices from '../../../api/invoices';
import * as orders from '../../../api/orders';
import * as quotations from '../../../api/quotations';
import * as deliveries from '../../../api/deliveries';
import * as products from '../../../api/products';
import * as tickets from '../../../api/tickets';
import * as rma from '../../../api/rma';
import * as warranty from '../../../api/warranty';
import * as subscriptions from '../../../api/subscriptions';
import * as analytics from '../../../api/analytics';

// Kartu data deterministik (Fase 1 poin 10). Aturannya satu dan mutlak: SETIAP angka yang dilihat
// pengguna di sini datang dari `load()` -- endpoint portal yang sebenarnya -- bukan dari teks yang
// diketik model. Model hanya memilih JENIS kartu dan id record-nya; isinya diambil ulang.
//
// Efek sampingnya penting: karena kartu memanggil endpoint portal biasa, RBAC endpoint itu
// berlaku lagi saat kartu dimuat. Kartu untuk data yang tidak berhak dilihat pengguna akan
// gagal dengan 403 dari sumbernya sendiri, bukan bergantung pada penyaringan di sisi asisten.
//
// Bentuk deklaratif, bukan satu komponen per jenis kartu: sembilan belas komponen yang isinya
// tabel-dengan-kolom-berbeda adalah sembilan belas tempat sebuah bug tabel bisa bersembunyi.
// AssistantCard.jsx yang merendernya.

const money = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString());
const date = (v) => (v ? String(v).slice(0, 10) : '—');

// `columns` merender tabel; `fields` merender daftar definisi; `summary` merender ubin angka.
// `link` adalah deep link ke modul terkait -- tujuan kartu bukan menggantikan modulnya, tapi
// mengantar pengguna ke sana.
export const CARD_TYPES = {
  OutstandingSummary: {
    title: 'Outstanding',
    link: () => '/invoices',
    load: () => invoices.getOutstanding(),
    summary: (d) => [
      { label: 'Belum lunas', value: d.count },
      { label: 'Total', value: `${d.currency || ''} ${money(d.total)}`.trim() },
    ],
  },

  InvoiceList: {
    title: 'Invoice',
    link: () => '/invoices',
    load: () => invoices.listInvoices(),
    columns: [
      { label: 'Nomor', get: (r) => r.name },
      { label: 'Jatuh tempo', get: (r) => date(r.invoice_date_due) },
      { label: 'Total', get: (r) => money(r.amount_total), numeric: true },
      { label: 'Sisa', get: (r) => money(r.amount_residual), numeric: true },
      { label: 'Status', get: (r) => r.payment_state, status: true },
    ],
  },

  InvoiceDetail: {
    title: 'Detail invoice',
    link: () => '/invoices',
    load: (ref) => invoices.getInvoice(ref.id),
    fields: [
      { label: 'Nomor', get: (d) => d.name },
      { label: 'Tanggal', get: (d) => date(d.invoice_date) },
      { label: 'Jatuh tempo', get: (d) => date(d.invoice_date_due) },
      { label: 'Total', get: (d) => money(d.amount_total) },
      { label: 'Sisa', get: (d) => money(d.amount_residual) },
      { label: 'Status', get: (d) => d.payment_state, status: true },
    ],
  },

  SpendingTrend: {
    title: 'Tren belanja',
    link: () => '/analytics',
    load: () => analytics.getSpendingTrend(),
    columns: [
      { label: 'Bulan', get: (r) => r.month },
      { label: 'Invoice', get: (r) => r.invoice_count, numeric: true },
      { label: 'Total', get: (r) => money(r.total), numeric: true },
    ],
  },

  OrderList: {
    title: 'Sales order',
    link: () => '/orders',
    load: () => orders.listOrders(),
    columns: [
      { label: 'Nomor', get: (r) => r.name },
      { label: 'Tanggal', get: (r) => date(r.date_order) },
      { label: 'Total', get: (r) => money(r.amount_total), numeric: true },
      { label: 'Status', get: (r) => r.state, status: true },
    ],
  },

  OrderDetail: {
    title: 'Detail order',
    link: (ref) => `/orders?id=${ref.id}`,
    load: (ref) => orders.getOrder(ref.id),
    fields: [
      { label: 'Nomor', get: (d) => d.name },
      { label: 'Tanggal', get: (d) => date(d.date_order) },
      { label: 'Total', get: (d) => money(d.amount_total) },
      { label: 'Penagihan', get: (d) => d.invoice_status, status: true },
      { label: 'Status', get: (d) => d.state, status: true },
    ],
  },

  OrderLines: {
    title: 'Isi order',
    link: (ref) => `/orders?id=${ref.orderId}`,
    load: (ref) => orders.listOrderLines(ref.orderId),
    columns: [
      { label: 'Produk', get: (r) => r.product_id?.[1] || r.name },
      { label: 'Qty', get: (r) => r.product_uom_qty, numeric: true },
      { label: 'Harga', get: (r) => money(r.price_unit), numeric: true },
      { label: 'Subtotal', get: (r) => money(r.price_total), numeric: true },
    ],
  },

  OrderVolumeTrend: {
    title: 'Tren order',
    link: () => '/analytics',
    load: () => analytics.getOrderVolumeTrend(),
    columns: [
      { label: 'Bulan', get: (r) => r.month },
      { label: 'Order', get: (r) => r.order_count, numeric: true },
      { label: 'Nilai', get: (r) => money(r.total), numeric: true },
    ],
  },

  QuotationList: {
    title: 'Penawaran',
    link: () => '/quotations',
    load: () => quotations.listQuotations(),
    columns: [
      { label: 'Nomor', get: (r) => r.name },
      { label: 'Berlaku s/d', get: (r) => date(r.validity_date) },
      { label: 'Total', get: (r) => money(r.amount_total), numeric: true },
      { label: 'Status', get: (r) => r.state, status: true },
    ],
  },

  QuotationDetail: {
    title: 'Detail penawaran',
    link: (ref) => `/quotations?id=${ref.id}`,
    load: (ref) => quotations.getQuotation(ref.id),
    fields: [
      { label: 'Nomor', get: (d) => d.name },
      { label: 'Tanggal', get: (d) => date(d.date_order) },
      { label: 'Berlaku s/d', get: (d) => date(d.validity_date) },
      { label: 'Total', get: (d) => money(d.amount_total) },
      { label: 'Status', get: (d) => d.state, status: true },
    ],
  },

  PurchaseHistory: {
    title: 'Riwayat pembelian',
    link: () => '/products',
    load: () => products.getPurchaseHistory(),
    columns: [
      { label: 'Produk', get: (r) => r.product_id?.[1] || r.name },
      { label: 'Qty', get: (r) => r.product_uom_qty, numeric: true },
      { label: 'Harga', get: (r) => money(r.price_unit), numeric: true },
    ],
  },

  ReorderSuggestions: {
    title: 'Sering dipesan',
    link: () => '/products',
    load: () => products.getReorderSuggestions(),
    columns: [
      { label: 'Produk', get: (r) => r.product_name },
      { label: 'Dipesan', get: (r) => `${r.order_count}x`, numeric: true },
      { label: 'Total qty', get: (r) => r.total_qty, numeric: true },
    ],
  },

  DeliveryList: {
    title: 'Pengiriman',
    link: () => '/deliveries',
    load: () => deliveries.listDeliveries(),
    columns: [
      { label: 'Nomor', get: (r) => r.name },
      { label: 'Rencana', get: (r) => date(r.scheduled_date) },
      { label: 'Selesai', get: (r) => date(r.date_done) },
      { label: 'Status', get: (r) => r.portal_status, status: true },
    ],
  },

  DeliveryTracking: {
    title: 'Lacak pengiriman',
    link: () => '/deliveries',
    load: (ref) => deliveries.getTracking(ref.id),
    fields: [
      { label: 'Status', get: (d) => d.status, status: true },
      { label: 'Rencana kirim', get: (d) => date(d.scheduled_date) },
      { label: 'Selesai', get: (d) => date(d.date_done) },
      { label: 'Nomor resi', get: (d) => d.carrier_tracking_ref || '—' },
    ],
  },

  TicketList: {
    title: 'Tiket',
    link: () => '/tickets',
    load: () => tickets.listTickets(),
    columns: [
      { label: 'Subjek', get: (r) => r.name },
      { label: 'Dibuat', get: (r) => date(r.create_date) },
      { label: 'Tahap', get: (r) => r.stage_id?.[1], status: true },
    ],
  },

  TicketDetail: {
    title: 'Detail tiket',
    link: (ref) => `/tickets?id=${ref.id}`,
    load: (ref) => tickets.getTicket(ref.id),
    fields: [
      { label: 'Subjek', get: (d) => d.name },
      { label: 'Dibuat', get: (d) => date(d.create_date) },
      { label: 'Tahap', get: (d) => d.stage_id?.[1], status: true },
    ],
  },

  RmaList: {
    title: 'RMA',
    link: () => '/rma',
    load: () => rma.listRma(),
    columns: [
      { label: 'Tindakan', get: (r) => r.requested_action },
      { label: 'Diajukan', get: (r) => date(r.created_at) },
      { label: 'Status', get: (r) => r.status, status: true },
    ],
  },

  WarrantyList: {
    title: 'Klaim garansi',
    link: () => '/warranty',
    load: () => warranty.listWarrantyClaims(),
    columns: [
      { label: 'Serial', get: (r) => r.serial_number },
      { label: 'Diajukan', get: (r) => date(r.created_at) },
      { label: 'Status', get: (r) => r.status, status: true },
    ],
  },

  SubscriptionList: {
    title: 'Langganan',
    link: () => '/subscriptions',
    load: () => subscriptions.listSubscriptions(),
    columns: [
      { label: 'Nomor', get: (r) => r.name },
      { label: 'Tagihan berikutnya', get: (r) => date(r.next_invoice_date) },
      { label: 'Nilai', get: (r) => money(r.amount_total), numeric: true },
      { label: 'Status', get: (r) => r.subscription_state || r.state, status: true },
    ],
  },
};

// Berapa baris yang ditampilkan di dalam panel selebar 360px sebelum menyuruh pengguna membuka
// modulnya. Bukan pemotongan diam-diam: AssistantCard menyebutkan jumlah yang tidak ditampilkan.
export const CARD_ROW_LIMIT = 5;

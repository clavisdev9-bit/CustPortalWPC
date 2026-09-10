// I-2: hanya me-require service domain (invoiceService/analyticsService), tidak pernah lapisan
// integrasi Odoo -- kunci partner_id/company_id dari resolveOdooContext hidup di dalam service
// itu, bukan di sini. Ditegakkan scripts/check-assistant-invariants.js.
const { z } = require('zod');
const invoiceService = require('../../invoiceService');
const analyticsService = require('../../analyticsService');
const { odooId, currencyOf, money, sampled } = require('./shared');

module.exports = [
  {
    name: 'get_outstanding_invoices',
    kind: 'read',
    permission: 'invoice.view',
    description:
      'Total dan jumlah invoice pelanggan yang belum lunas beserta mata uangnya. ' +
      'Pakai untuk pertanyaan tentang sisa tagihan atau outstanding.',
    args: z.object({}).strict(),
    handler: (ctx) => invoiceService.getOutstanding(ctx.userId, ctx.companyId),
    card: 'OutstandingSummary',
    summarize: (r) =>
      r.count === 0
        ? 'Tidak ada invoice outstanding.'
        : `outstanding: ${r.count} invoice, total ${money(r.total, r.currency)}`,
  },

  {
    name: 'list_invoices',
    kind: 'read',
    permission: 'invoice.view',
    description:
      'Daftar invoice pelanggan yang sudah diterbitkan, dengan tanggal, jatuh tempo, total, ' +
      'sisa yang belum dibayar, dan status pembayarannya. Pakai untuk pertanyaan tentang ' +
      'invoice tertentu, invoice terbaru, atau invoice yang jatuh tempo.',
    args: z.object({}).strict(),
    handler: (ctx) => invoiceService.listInvoices(ctx.userId, ctx.companyId),
    card: 'InvoiceList',
    // card_ref sengaja kosong: kartu InvoiceList memuat ulang daftarnya sendiri lewat
    // GET /invoices, sehingga angka yang dilihat pengguna datang dari API, bukan dari model.
    summarize: (invoices) => {
      if (invoices.length === 0) return 'Tidak ada invoice.';
      const unpaid = invoices.filter((i) => i.payment_state !== 'paid');
      const detail = sampled(
        invoices,
        (i) => `${i.name} (${i.invoice_date}, jatuh tempo ${i.invoice_date_due || '-'}, ` +
          `total ${money(i.amount_total, currencyOf(i))}, sisa ${money(i.amount_residual, currencyOf(i))}, ${i.payment_state})`
      );
      return `${invoices.length} invoice, ${unpaid.length} belum lunas. ${detail}`;
    },
  },

  {
    name: 'get_invoice',
    kind: 'read',
    permission: 'invoice.view',
    description:
      'Detail satu invoice berdasarkan id-nya. Pakai hanya kalau id invoice sudah diketahui ' +
      'dari hasil list_invoices sebelumnya -- jangan menebak id.',
    args: z.object({
      invoiceId: odooId('Id numerik invoice, diambil dari hasil list_invoices'),
    }).strict(),
    handler: (ctx, args) => invoiceService.getInvoice(ctx.userId, ctx.companyId, args.invoiceId),
    card: 'InvoiceDetail',
    cardRef: (invoice) => ({ id: invoice.id }),
    summarize: (i) =>
      `${i.name}: terbit ${i.invoice_date}, jatuh tempo ${i.invoice_date_due || '-'}, ` +
      `total ${money(i.amount_total, currencyOf(i))}, sisa ${money(i.amount_residual, currencyOf(i))}, status ${i.payment_state}`,
  },

  {
    name: 'get_spending_trend',
    kind: 'read',
    // 'analytics.view' TIDAK ADA di portal_permissions -- route analytics pun menumpang
    // invoice.view/order.view (CLAUDE.md, spec section 8). Jangan mengarang permission baru.
    permission: 'invoice.view',
    description:
      'Total belanja pelanggan per bulan, sudah diagregasi oleh sistem. Pakai untuk pertanyaan ' +
      'tentang tren pengeluaran, belanja bulanan, atau perbandingan antar bulan. ' +
      'Kutip angkanya apa adanya, jangan dijumlahkan ulang.',
    args: z.object({}).strict(),
    handler: (ctx) => analyticsService.getSpendingTrend(ctx.userId, ctx.companyId),
    card: 'SpendingTrend',
    summarize: (rows) => {
      if (rows.length === 0) return 'Belum ada data belanja.';
      const recent = rows.slice(-6).map((r) => `${r.month}: ${r.total} (${r.invoice_count} invoice)`).join('; ');
      return `tren belanja ${rows.length} bulan. Enam terakhir -- ${recent}`;
    },
  },
];

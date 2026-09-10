const { z } = require('zod');
const salesService = require('../../salesService');
const analyticsService = require('../../analyticsService');
const { odooId, currencyOf, money, sampled } = require('./shared');

function formatOrder(order) {
  return `${order.name} (${order.state}, ${money(order.amount_total, currencyOf(order))})`;
}

module.exports = [
  {
    name: 'list_orders',
    kind: 'read',
    permission: 'order.view',
    description:
      'Daftar sales order pelanggan yang sudah dikonfirmasi (bukan quotation), dengan status ' +
      'dan total masing-masing. Pakai untuk pertanyaan tentang pesanan atau order terbaru.',
    args: z.object({}).strict(),
    handler: (ctx) => salesService.listOrders(ctx.userId, ctx.companyId),
    card: 'OrderList',
    summarize: (orders) =>
      orders.length === 0
        ? 'Tidak ada sales order.'
        : `${orders.length} order. ${sampled(orders, formatOrder)}`,
  },

  {
    name: 'get_order',
    kind: 'read',
    permission: 'order.view',
    description:
      'Detail satu sales order berdasarkan id-nya. Pakai hanya kalau id order sudah diketahui ' +
      'dari hasil list_orders sebelumnya -- jangan menebak id.',
    args: z.object({
      orderId: odooId('Id numerik sales order, diambil dari hasil list_orders'),
    }).strict(),
    handler: (ctx, args) => salesService.getOrder(ctx.userId, ctx.companyId, args.orderId),
    card: 'OrderDetail',
    cardRef: (order) => ({ id: order.id }),
    summarize: (o) =>
      `${o.name}: tanggal ${o.date_order}, status ${o.state}, status penagihan ${o.invoice_status}, ` +
      `total ${money(o.amount_total, currencyOf(o))}`,
  },

  {
    name: 'list_order_lines',
    kind: 'read',
    permission: 'order.view',
    description:
      'Baris item (produk, kuantitas, harga yang benar-benar tertagih) di dalam satu sales ' +
      'order. Pakai untuk "apa isi order ini" atau "berapa harga produk X di order itu".',
    args: z.object({
      orderId: odooId('Id numerik sales order, diambil dari hasil list_orders'),
    }).strict(),
    handler: (ctx, args) => salesService.listOrderLines(ctx.userId, ctx.companyId, args.orderId),
    card: 'OrderLines',
    // Argumen tool dipakai untuk card_ref di sini, bukan hasilnya: hasilnya array baris yang
    // tidak memuat id order-nya sendiri, sedangkan kartu perlu tahu order mana yang dimuat ulang.
    cardRef: (lines, args) => ({ orderId: args.orderId }),
    summarize: (lines) =>
      lines.length === 0
        ? 'Order ini tidak punya baris item.'
        : `${lines.length} baris. ` +
          sampled(lines, (l) => `${l.product_id?.[1] || l.name} x${l.product_uom_qty} = ${l.price_total}`),
  },

  {
    name: 'get_order_volume_trend',
    kind: 'read',
    // Sama seperti get_spending_trend: 'analytics.view' tidak ada, jadi menumpang order.view.
    permission: 'order.view',
    description:
      'Jumlah dan nilai order pelanggan per bulan, sudah diagregasi oleh sistem. Pakai untuk ' +
      'pertanyaan tentang tren pemesanan. Kutip angkanya apa adanya, jangan dijumlahkan ulang.',
    args: z.object({}).strict(),
    handler: (ctx) => analyticsService.getOrderVolumeTrend(ctx.userId, ctx.companyId),
    card: 'OrderVolumeTrend',
    summarize: (rows) => {
      if (rows.length === 0) return 'Belum ada data order.';
      const recent = rows.slice(-6).map((r) => `${r.month}: ${r.order_count} order, ${r.total}`).join('; ');
      return `tren order ${rows.length} bulan. Enam terakhir -- ${recent}`;
    },
  },

  {
    name: 'list_quotations',
    kind: 'read',
    permission: 'quotation.view',
    description:
      'Daftar penawaran (quotation) yang belum menjadi order, dengan total dan batas berlakunya. ' +
      'Pakai untuk pertanyaan tentang penawaran yang menunggu persetujuan.',
    args: z.object({}).strict(),
    handler: (ctx) => salesService.listQuotations(ctx.userId, ctx.companyId),
    card: 'QuotationList',
    summarize: (quotations) =>
      quotations.length === 0
        ? 'Tidak ada penawaran terbuka.'
        : `${quotations.length} penawaran. ` +
          sampled(quotations, (q) => `${q.name} (${money(q.amount_total, currencyOf(q))}, berlaku sampai ${q.validity_date || '-'})`),
  },

  {
    name: 'get_quotation',
    kind: 'read',
    permission: 'quotation.view',
    description:
      'Detail satu penawaran berdasarkan id-nya. Pakai hanya kalau id-nya sudah diketahui dari ' +
      'hasil list_quotations sebelumnya -- jangan menebak id.',
    args: z.object({
      quotationId: odooId('Id numerik penawaran, diambil dari hasil list_quotations'),
    }).strict(),
    // Spec section 8 menulis `salesService.getQuotation`, tapi method itu tidak ada: penawaran
    // dan order adalah sale.order yang sama di Odoo, dan route /quotations/:id pun memakai
    // salesController.getOrder. Memakai yang benar-benar ada, bukan membuat alias baru.
    handler: (ctx, args) => salesService.getOrder(ctx.userId, ctx.companyId, args.quotationId),
    card: 'QuotationDetail',
    cardRef: (quotation) => ({ id: quotation.id }),
    summarize: (q) =>
      `${q.name}: tanggal ${q.date_order}, status ${q.state}, berlaku sampai ${q.validity_date || '-'}, ` +
      `total ${money(q.amount_total, currencyOf(q))}`,
  },
];

const { z } = require('zod');
const deliveryService = require('../../deliveryService');
const { odooId, sampled } = require('./shared');

module.exports = [
  {
    name: 'list_deliveries',
    kind: 'read',
    permission: 'delivery.view',
    description:
      'Daftar pengiriman pelanggan dengan status portal, tanggal rencana kirim, dan tanggal ' +
      'selesai. Pakai untuk pertanyaan tentang pengiriman atau "pesanan saya sudah dikirim?".',
    args: z.object({}).strict(),
    handler: (ctx) => deliveryService.listDeliveries(ctx.userId, ctx.companyId),
    card: 'DeliveryList',
    summarize: (deliveries) =>
      deliveries.length === 0
        ? 'Tidak ada pengiriman.'
        : `${deliveries.length} pengiriman. ` +
          sampled(deliveries, (d) => `${d.name} (${d.portal_status}, rencana ${d.scheduled_date || '-'}, selesai ${d.date_done || 'belum'})`),
  },

  {
    name: 'get_delivery_tracking',
    kind: 'read',
    permission: 'delivery.view',
    description:
      'Status dan nomor resi satu pengiriman berdasarkan id-nya. Pakai hanya kalau id-nya sudah ' +
      'diketahui dari hasil list_deliveries sebelumnya -- jangan menebak id. ' +
      'Sebutkan nomor resi apa adanya, dan jangan menjanjikan tanggal tiba.',
    args: z.object({
      pickingId: odooId('Id numerik pengiriman, diambil dari hasil list_deliveries'),
    }).strict(),
    handler: (ctx, args) => deliveryService.getTracking(ctx.userId, ctx.companyId, args.pickingId),
    card: 'DeliveryTracking',
    cardRef: (tracking) => ({ id: tracking.id }),
    summarize: (t) =>
      `pengiriman #${t.id}: status ${t.status}, rencana ${t.scheduled_date || '-'}, ` +
      `selesai ${t.date_done || 'belum'}, resi ${t.carrier_tracking_ref || 'belum ada'}`,
  },
];

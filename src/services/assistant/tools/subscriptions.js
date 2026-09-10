const { z } = require('zod');
const subscriptionService = require('../../subscriptionService');
const { currencyOf, money, sampled } = require('./shared');

module.exports = [
  {
    name: 'list_subscriptions',
    kind: 'read',
    permission: 'subscription.view',
    description:
      'Daftar langganan aktif pelanggan dengan nilai, tanggal mulai, dan tanggal penagihan ' +
      'berikutnya. Pakai untuk pertanyaan tentang langganan atau kapan tagihan berikutnya terbit. ' +
      'Sebutkan tanggalnya apa adanya -- jangan menghitung sisa hari sendiri.',
    args: z.object({}).strict(),
    handler: (ctx) => subscriptionService.listSubscriptions(ctx.userId, ctx.companyId),
    card: 'SubscriptionList',
    summarize: (subs) =>
      subs.length === 0
        ? 'Tidak ada langganan.'
        : `${subs.length} langganan. ` +
          sampled(subs, (s) => `${s.name} (${s.subscription_state || s.state}, ${money(s.amount_total, currencyOf(s))}, ` +
            `tagihan berikutnya ${s.next_invoice_date || '-'})`),
  },
];

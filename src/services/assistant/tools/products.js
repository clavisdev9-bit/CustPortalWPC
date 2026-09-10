const { z } = require('zod');
const productService = require('../../productService');
const { sampled } = require('./shared');

// Catatan section 8.1: `list_products` SENGAJA tidak ada di registry ini. `list_price` di Odoo
// adalah harga standar, bukan harga pricelist pelanggan -- menyebutkannya lewat asisten sama
// dengan memberi informasi komersial yang salah. Kebutuhan "info produk" dijawab dari riwayat
// pembelian (harga yang benar-benar pernah dibayar) sampai RAG Fase 4 ada.

module.exports = [
  {
    name: 'get_purchase_history',
    kind: 'read',
    permission: 'product.view',
    description:
      'Riwayat produk yang pernah dibeli pelanggan, dengan harga yang benar-benar pernah ' +
      'dibayar (bukan harga katalog). Pakai untuk "apakah saya pernah beli X" atau riwayat pembelian. ' +
      'Jangan dipakai untuk menyebut harga katalog produk yang belum pernah dibeli.',
    args: z.object({}).strict(),
    handler: (ctx) => productService.getPurchaseHistory(ctx.userId, ctx.companyId),
    card: 'PurchaseHistory',
    summarize: (lines) => {
      if (lines.length === 0) return 'Tidak ada riwayat pembelian.';
      const byProduct = new Map();
      for (const line of lines) {
        const name = line.product_id?.[1] || 'Unknown';
        const existing = byProduct.get(name) || { qty: 0, count: 0 };
        existing.qty += line.product_uom_qty || 0;
        existing.count += 1;
        byProduct.set(name, existing);
      }
      const top = Array.from(byProduct.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 8)
        .map(([name, v]) => `${name} (qty ${v.qty})`);
      return `${lines.length} baris pembelian dari ${byProduct.size} produk berbeda: ${top.join('; ')}`;
    },
  },

  {
    name: 'get_reorder_suggestions',
    kind: 'read',
    permission: 'product.view',
    description:
      'Produk yang paling sering dipesan ulang oleh pelanggan ini, diurutkan dari yang paling ' +
      'sering. Pakai untuk "apa yang biasanya saya pesan" atau saran pemesanan ulang. ' +
      'Ini hanya riwayat pelanggan sendiri, bukan rekomendasi produk baru.',
    args: z.object({}).strict(),
    handler: (ctx) => productService.getReorderSuggestions(ctx.userId, ctx.companyId),
    card: 'ReorderSuggestions',
    summarize: (items) =>
      items.length === 0
        ? 'Belum ada produk yang pernah dipesan berulang.'
        : `${items.length} produk sering dipesan: ` +
          sampled(items, (i) => `${i.product_name} (${i.order_count}x, total qty ${i.total_qty})`),
  },
];

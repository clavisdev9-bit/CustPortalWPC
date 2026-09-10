// Tiket, RMA, dan klaim garansi -- tool baca DAN tool draf aksi tulis (Fase 2).
//
// Tool `draft_*` di bawah TIDAK membuat apa pun di Odoo. Masing-masing hanya menulis satu baris
// `assistant_action_drafts`; eksekusi terjadi di POST /assistant/drafts/:id/confirm yang dipicu
// klik pengguna (I-5). Kalau suatu saat handler di sini terlihat memanggil helpdeskService.create*
// atau rmaService.create*, alurnya sudah salah -- itu jalur yang boleh dilewati hanya oleh
// endpoint confirm.
//
// Catatan permission (spec section 12 catatan D6, sudah ditindaklanjuti di seed 0014):
// 'ticket.view', 'ticket.create', dan 'ticket.reply' kini dimiliki keempat role pelanggan, jadi
// `draft_ticket` tersedia untuk semuanya. 'rma.create' dan 'warranty.create' SENGAJA tetap hanya
// Customer Admin -- keduanya berkonsekuensi komersial (refund, penggantian barang).
//
// Konsekuensinya di sini: untuk pengguna non-admin, `draft_rma` dan `draft_warranty` tidak pernah
// dikirim ke model sama sekali (section 7.2 poin 3). Permintaan refund mereka akan jatuh ke
// `draft_ticket` sebagai tiket umum, dan staf yang mengonversinya. Itu memang jalur yang
// diinginkan -- deskripsi tool di bawah tidak perlu menjelaskan pembatasan ini kepada model,
// karena model tidak pernah tahu tool itu ada.
const { z } = require('zod');
const helpdeskService = require('../../helpdeskService');
const rmaService = require('../../rmaService');
const warrantyService = require('../../warrantyService');
const actions = require('../actions');
const draftService = require('../draftService');
const { odooId, sampled, stripHtml } = require('./shared');

// Ringkasan yang dibaca model setelah draf dibuat. Kalimatnya sengaja menegaskan bahwa BELUM ada
// yang terkirim: model membaca ringkasan ini lalu meneruskannya ke pengguna, dan "tiket sudah
// dibuat" adalah kebohongan yang lahir persis di sini.
function draftSummary(jenis) {
  return `Draf ${jenis} sudah disiapkan dan sedang ditampilkan ke pengguna. BELUM dikirim -- ` +
    'pengguna harus menekan tombol kirim sendiri. Jangan katakan sudah terkirim.';
}

module.exports = [
  {
    name: 'list_tickets',
    kind: 'read',
    permission: 'ticket.view',
    description:
      'Daftar tiket support pelanggan beserta tahap penanganannya. Pakai untuk pertanyaan ' +
      'tentang keluhan atau permintaan bantuan yang sedang berjalan.',
    args: z.object({}).strict(),
    handler: (ctx) => helpdeskService.listTickets(ctx.userId, ctx.companyId),
    card: 'TicketList',
    summarize: (tickets) =>
      tickets.length === 0
        ? 'Tidak ada tiket.'
        : `${tickets.length} tiket. ` +
          sampled(tickets, (t) => `#${t.id} ${t.name} (${t.stage_id?.[1] || 'tanpa tahap'}, dibuat ${t.create_date})`),
  },

  {
    name: 'get_ticket',
    kind: 'read',
    permission: 'ticket.view',
    description:
      'Detail satu tiket support berdasarkan id-nya, termasuk uraian masalahnya. Pakai hanya ' +
      'kalau id-nya sudah diketahui dari hasil list_tickets sebelumnya -- jangan menebak id.',
    args: z.object({
      ticketId: odooId('Id numerik tiket, diambil dari hasil list_tickets'),
    }).strict(),
    handler: (ctx, args) => helpdeskService.getTicket(ctx.userId, ctx.companyId, args.ticketId),
    card: 'TicketDetail',
    cardRef: (ticket) => ({ id: ticket.id }),
    // Salah satu dari dua tool yang mengembalikan teks tulisan manusia lain (I-6). Pembungkus
    // penanda batasnya dipasang orkestrator untuk SEMUA tool, bukan hanya di sini -- guard yang
    // hanya menyala pada tool "berbahaya" akan terlewat begitu ada tool baru ditambahkan.
    summarize: (t) =>
      `#${t.id} ${t.name}: tahap ${t.stage_id?.[1] || '-'}, prioritas ${t.priority || '-'}, ` +
      `dibuat ${t.create_date}. Uraian: ${stripHtml(t.description) || '(kosong)'}`,
  },

  {
    name: 'list_rma',
    kind: 'read',
    permission: 'rma.view',
    description:
      'Daftar permintaan retur (RMA) yang pernah diajukan pelanggan, dengan alasan dan status ' +
      'penanganannya. Pakai untuk pertanyaan tentang pengembalian atau penukaran barang.',
    args: z.object({}).strict(),
    handler: (ctx) => rmaService.listRma(ctx.userId, ctx.companyId),
    card: 'RmaList',
    summarize: (rows) =>
      rows.length === 0
        ? 'Tidak ada permintaan RMA.'
        : `${rows.length} RMA. ` +
          sampled(rows, (r) => `${r.requested_action} (${r.status || 'tanpa status'}, diajukan ${r.created_at})`),
  },

  {
    name: 'list_warranty_claims',
    kind: 'read',
    permission: 'warranty.view',
    description:
      'Daftar klaim garansi pelanggan beserta nomor seri dan status penanganannya. Pakai untuk ' +
      'pertanyaan tentang garansi barang yang sudah diklaim.',
    args: z.object({}).strict(),
    handler: (ctx) => warrantyService.listClaims(ctx.userId, ctx.companyId),
    card: 'WarrantyList',
    // Catatan section 8.1: `lookup_serial` SENGAJA tidak ada. Ia mencari stock.lot APA PUN di
    // inventori tanpa scope pelanggan, jadi memakainya untuk mengonfirmasi kepemilikan justru
    // membocorkan keberadaan serial milik orang lain.
    summarize: (rows) =>
      rows.length === 0
        ? 'Tidak ada klaim garansi.'
        : `${rows.length} klaim. ` +
          sampled(rows, (r) => `serial ${r.serial_number} (${r.status || 'tanpa status'}, diajukan ${r.created_at})`),
  },

  // ------------------------------------------------------------ aksi tulis --
  // Skema argumen ketiganya diambil dari actions.js, BUKAN didefinisikan ulang di sini. Satu
  // sumber skema per aksi adalah inti alur draf: `confirm` memvalidasi ulang payload tersimpan,
  // dan kalau tool memakai skema sendiri, dua sisi itu akan menyimpang diam-diam.

  {
    name: 'draft_ticket',
    kind: 'draft',
    permission: 'ticket.create',
    description:
      'Menyiapkan DRAF tiket support dari keluhan atau permintaan bantuan pengguna. ' +
      'Tool ini TIDAK mengirim apa pun -- pengguna yang menekan tombol kirim. ' +
      'Pakai untuk keluhan umum: layanan, pertanyaan teknis, keterlambatan, atau apa pun yang ' +
      'bukan permintaan pengembalian barang dan bukan klaim garansi. ' +
      'Tulis "name" sebagai satu kalimat subjek yang jelas bagi staf, dan "description" dengan ' +
      'kata-kata pengguna sendiri beserta detail yang sudah kamu kumpulkan (nomor order, tanggal, ' +
      'apa yang sudah dicoba). Pahami dulu masalahnya sebelum memanggil tool ini.',
    args: actions.get('create_ticket').draftSchema,
    handler: (ctx, args) => draftService.create(ctx, 'create_ticket', args),
    summarize: () => draftSummary('tiket'),
  },

  {
    name: 'draft_rma',
    kind: 'draft',
    permission: 'rma.create',
    description:
      'Menyiapkan DRAF permintaan retur (RMA) saat pengguna ingin mengembalikan barang untuk ' +
      'DIKEMBALIKAN UANGNYA (refund) atau DIGANTI (replacement). Tool ini TIDAK mengirim apa pun. ' +
      'Jangan pakai untuk barang cacat yang punya nomor seri -- itu klaim garansi (draft_warranty). ' +
      'Sebelum memanggil, panggil list_orders lebih dulu dan tawarkan kandidat ordernya, jangan ' +
      'menyuruh pengguna mengingat nomor order sendiri. Isi "order_id" hanya kalau pengguna sudah ' +
      'memastikan ordernya; kosongkan kalau belum jelas.',
    args: actions.get('create_rma').draftSchema,
    handler: (ctx, args) => draftService.create(ctx, 'create_rma', args),
    summarize: () => draftSummary('RMA'),
  },

  {
    name: 'draft_warranty',
    kind: 'draft',
    permission: 'warranty.create',
    description:
      'Menyiapkan DRAF klaim garansi untuk barang CACAT atau RUSAK yang punya NOMOR SERI. ' +
      'Tool ini TIDAK mengirim apa pun. Wajib ada nomor seri -- kalau pengguna belum ' +
      'menyebutkannya, tanyakan dulu, jangan menebak dan jangan mencarikannya. ' +
      'Kalau pengguna hanya ingin uangnya kembali atau barang ditukar tanpa persoalan cacat, ' +
      'itu RMA (draft_rma), bukan garansi.',
    args: actions.get('create_warranty').draftSchema,
    handler: (ctx, args) => draftService.create(ctx, 'create_warranty', args),
    summarize: () => draftSummary('klaim garansi'),
  },
];

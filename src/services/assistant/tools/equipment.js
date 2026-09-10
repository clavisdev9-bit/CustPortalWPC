// Installed base / "My Equipment" -- empat tool baca (CR Docs/CR/customer_population_installed_base.md
// section 13). Semua memanggil equipmentService, tidak pernah lapisan integrasi Odoo secara
// langsung (I-2), dan argumennya tidak pernah memuat field identitas (I-1) -- scoping keluarga
// partner (D-4) dihitung server-side di equipmentService dari identitas yang sudah diresolusi.
const { z } = require('zod');
const equipmentService = require('../../equipmentService');
const actions = require('../actions');
const draftService = require('../draftService');
const { odooId, sampled } = require('./shared');

module.exports = [
  {
    name: 'list_my_equipment',
    kind: 'read',
    permission: 'equipment.view',
    description:
      'Daftar mesin/unit yang dimiliki pelanggan ini (installed base), termasuk model, lokasi, ' +
      'dan status. Pakai untuk "mesin apa saja yang saya punya" atau semacamnya.',
    args: z.object({}).strict(),
    handler: (ctx) => equipmentService.listUnits(ctx.userId, ctx.companyId),
    card: 'EquipmentList',
    summarize: (units) =>
      units.length === 0
        ? 'Tidak ada mesin terdaftar.'
        : `${units.length} unit. ` +
          sampled(units, (u) => `${u.name} (${u.model?.name || 'model tidak diketahui'}, ${u.status || 'status tidak diketahui'})`),
  },

  {
    name: 'get_equipment_detail',
    kind: 'read',
    permission: 'equipment.view',
    description:
      'Detail satu unit mesin berdasarkan id-nya, termasuk komponen yang tercatat di dalamnya. ' +
      'Pakai hanya kalau id-nya sudah diketahui dari hasil list_my_equipment -- jangan menebak id.',
    args: z.object({
      equipmentId: odooId('Id numerik unit, diambil dari hasil list_my_equipment'),
    }).strict(),
    handler: (ctx, args) => equipmentService.getUnit(ctx.userId, ctx.companyId, args.equipmentId),
    card: 'EquipmentDetail',
    cardRef: (unit) => ({ id: unit.id }),
    summarize: (u) =>
      `${u.name}: model ${u.model?.name || '-'}, kategori ${u.category?.name || '-'}, status ${u.status || '-'}, ` +
      `terpasang ${u.install_date || 'tidak diketahui'}, lokasi ${u.location || '-'}. ` +
      (u.components.length > 0
        ? `${u.components.length} komponen tercatat: ` + sampled(u.components, (c) => c.name)
        : 'Tidak ada komponen tercatat terpisah.'),
  },

  {
    name: 'get_due_replacements',
    kind: 'read',
    permission: 'equipment.view',
    description:
      'Sparepart yang sudah atau hampir jatuh tempo diganti pada mesin milik pelanggan ini, ' +
      'beserta dasar perhitungannya. Pakai untuk "apa yang perlu saya ganti" atau "kapan servis ' +
      'berikutnya". Jangan dipakai untuk menyebut harga.',
    args: z.object({}).strict(),
    handler: (ctx) => equipmentService.getDueReplacements(ctx.userId, ctx.companyId),
    card: 'DueReplacements',
    // IB-4: ringkasan WAJIB membawa dasar dan atribusi. Tanpa itu model akan menyajikan estimasi
    // level armada sebagai fakta per unit -- persis kesalahan yang D-5 hindari.
    summarize: (rows) => {
      if (rows.length === 0) return 'Tidak ada sparepart yang jatuh tempo.';
      const overdue = rows.filter((r) => r.status === 'overdue');
      const estimated = rows.filter((r) => r.attribution === 'fleet_estimated').length;
      return (
        `${rows.length} sparepart perlu perhatian (${overdue.length} lewat jadwal). ` +
        sampled(rows, (r) => `${r.part.name} pada ${r.equipment_name} (${r.status}, jatuh tempo ${r.due_date})`) +
        (estimated > 0
          ? `. ${estimated} di antaranya estimasi level armada, bukan per unit -- sampaikan sebagai perkiraan.`
          : '')
      );
    },
  },

  {
    name: 'get_equipment_service_history',
    kind: 'read',
    permission: 'equipment.view',
    description:
      'Riwayat maintenance request (servis terjadwal) untuk satu unit mesin, termasuk komponennya. ' +
      'Pakai untuk "kapan terakhir mesin ini diservis" atau riwayat perawatan. Belum mencakup ' +
      'tiket atau klaim garansi -- keduanya belum tertaut ke unit di Odoo.',
    args: z.object({
      equipmentId: odooId('Id numerik unit, diambil dari hasil list_my_equipment'),
    }).strict(),
    handler: (ctx, args) => equipmentService.getServiceHistory(ctx.userId, ctx.companyId, args.equipmentId),
    card: 'ServiceHistory',
    cardRef: (_, args) => ({ id: args.equipmentId }),
    summarize: (rows) =>
      rows.length === 0
        ? 'Tidak ada riwayat maintenance request untuk unit ini.'
        : `${rows.length} riwayat servis. ` +
          sampled(rows, (r) => `${r.name} (${r.maintenance_type || '-'}, ${r.stage || 'tanpa tahap'}, dijadwalkan ${r.schedule_date || '-'})`),
  },

  // ------------------------------------------------------------ aksi tulis (Fase 4) --
  // Skema argumen diambil dari actions.js, BUKAN didefinisikan ulang di sini -- satu sumber skema
  // per aksi, sama seperti draft_ticket/draft_rma/draft_warranty di tools/support.js. Handler ini
  // TIDAK memanggil equipmentService.createCorrection langsung -- ia hanya menulis satu baris
  // draf; eksekusi hanya terjadi lewat POST /assistant/drafts/:id/confirm yang dipicu klik
  // pengguna (I-5).
  {
    name: 'draft_equipment_correction',
    kind: 'draft',
    permission: 'equipment.correct',
    description:
      'Menyiapkan DRAF permintaan koreksi data mesin/unit (lokasi, status, jam operasi, atau ' +
      'kepemilikan yang tercatat salah di installed base). Tool ini TIDAK mengirim apa pun -- ' +
      'pengguna yang menekan tombol kirim. Pakai list_my_equipment lebih dulu dan tawarkan ' +
      'kandidat unitnya -- jangan menyuruh pengguna mengingat id unit sendiri. "correction_type" ' +
      'harus salah satu dari: location, status, runtime_hours, ownership, other. "proposed_value" ' +
      'diisi nilai yang menurut pengguna benar, apa adanya.',
    args: actions.get('create_equipment_correction').draftSchema,
    handler: (ctx, args) => draftService.create(ctx, 'create_equipment_correction', args),
    summarize: () =>
      'Draf permintaan koreksi sudah disiapkan dan sedang ditampilkan ke pengguna. BELUM dikirim ' +
      '-- pengguna harus menekan tombol kirim sendiri. Jangan katakan sudah terkirim.',
  },
];

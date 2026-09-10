// Katalog aksi tulis asisten (Fase 2, spec section 13). Satu-satunya tempat di mana tool `draft_*`
// dan endpoint `confirm` sepakat tentang: skema payload, permission, service yang dieksekusi, dan
// bagaimana hasilnya ditautkan kembali ke portal.
//
// Kenapa satu tabel dan bukan tiga cabang if: dua sisi alur ini dipisahkan oleh permintaan HTTP
// berbeda dan oleh waktu (draf bisa dikonfirmasi 20 menit kemudian). Kalau tiap sisi punya
// pengetahuannya sendiri tentang "apa arti create_rma", keduanya akan menyimpang -- dan yang
// menyimpang diam-diam adalah skema payload, yang berarti validasi ulang di `confirm` memvalidasi
// bentuk yang salah.
//
// I-2 tetap berlaku: hanya service domain yang dipanggil, tidak pernah lapisan integrasi Odoo
// secara langsung -- kunci partner_id/company_id hidup di dalam service itu.
// (Catatan: check-assistant-invariants.js mencari string mentah, sesuai spec 7.3. Jadi menulis
// nama path terlarang itu di komentar pun akan menggagalkannya -- itu memang disengaja tumpul.)
const { createTicketSchema } = require('../../validators/helpdeskValidators');
const { createRmaSchema } = require('../../validators/rmaValidators');
const { createWarrantyClaimSchema } = require('../../validators/warrantyValidators');
const { createCorrectionSchema } = require('../../validators/equipmentValidators');
const helpdeskService = require('../helpdeskService');
const rmaService = require('../rmaService');
const warrantyService = require('../warrantyService');
const equipmentService = require('../equipmentService');

// Payload draf disimpan dalam bentuk SKEMA VALIDATOR (snake_case), bukan bentuk service
// (camelCase). Ini bukan selera: `confirm` harus bisa mem-parse ulang payload tersimpan dengan
// skema yang sama persis dipakai endpoint aslinya, dan controller REST yang ada (rmaController,
// warrantyController) memang memetakan snake -> camel di perbatasan itu. `execute` di bawah
// melakukan pemetaan yang sama, di satu tempat.
//
// Dua skema per aksi, dan hubungan di antaranya penting:
//
//   schema      -- persis yang dipakai endpoint REST aslinya. Ini yang dipakai `confirm` untuk
//                  memvalidasi ulang payload tersimpan.
//   draftSchema -- turunan yang lebih KETAT, dipakai saat model membuat draf.
//
// Arah pengetatannya sengaja satu arah saja: apa pun yang lolos `draftSchema` dijamin lolos
// `schema`, jadi draf yang sah tidak akan pernah ditolak saat dikonfirmasi. Yang diperketat:
// `.strict()` (argumen tak dikenal ditolak, bukan diabaikan -- section 7.2 poin 2) dan, untuk
// tiket, `description` yang di REST bersifat opsional dijadikan wajib. Tiket keluhan tanpa uraian
// praktis tidak berguna bagi staf, dan model yang dibiarkan mengosongkannya akan mengosongkannya.
const ACTIONS = {
  create_ticket: {
    schema: createTicketSchema,
    draftSchema: createTicketSchema.strict().required({ description: true }),
    permission: 'ticket.create',
    targetType: 'helpdesk.ticket',
    execute: (userId, companyId, payload) =>
      helpdeskService.createTicket(userId, companyId, {
        name: payload.name,
        description: payload.description,
      }),
    resultRef: (ticket) => String(ticket.id),
    // Tiket helpdesk yang dihasilkan RMA/garansi juga dipakai untuk melampirkan transkrip --
    // ketiganya bermuara di helpdesk.ticket, hanya lewat pintu berbeda.
    ticketId: (ticket) => ticket.id,
    deepLink: (ticket) => `/tickets?id=${ticket.id}`,
    label: (ticket) => `#${ticket.id} ${ticket.name}`,
  },

  create_rma: {
    schema: createRmaSchema,
    draftSchema: createRmaSchema.strict(),
    permission: 'rma.create',
    targetType: 'rma_request',
    execute: (userId, companyId, payload) =>
      rmaService.createRma(userId, companyId, {
        orderId: payload.order_id,
        reason: payload.reason,
        requestedAction: payload.requested_action,
      }),
    resultRef: (rma) => String(rma.id),
    ticketId: (rma) => rma.ticket_id,
    deepLink: (rma) => `/rma?id=${rma.id}`,
    label: (rma) => `RMA #${rma.ticket_id}`,
  },

  create_warranty: {
    schema: createWarrantyClaimSchema,
    draftSchema: createWarrantyClaimSchema.strict(),
    permission: 'warranty.create',
    targetType: 'warranty_claim',
    execute: (userId, companyId, payload) =>
      warrantyService.createClaim(userId, companyId, {
        serialNumber: payload.serial_number,
        issueDescription: payload.issue_description,
      }),
    resultRef: (claim) => String(claim.id),
    ticketId: (claim) => claim.ticket_id,
    deepLink: (claim) => `/warranty?id=${claim.id}`,
    label: (claim) => `Klaim garansi #${claim.ticket_id}`,
  },

  create_equipment_correction: {
    schema: createCorrectionSchema,
    draftSchema: createCorrectionSchema.strict(),
    permission: 'equipment.correct',
    targetType: 'equipment_correction',
    execute: (userId, companyId, payload) =>
      equipmentService.createCorrection(userId, companyId, payload.equipment_id, {
        correctionType: payload.correction_type,
        proposedValue: payload.proposed_value,
        note: payload.note,
      }),
    resultRef: (correction) => String(correction.id),
    ticketId: (correction) => correction.ticket_id,
    deepLink: () => '/equipment',
    label: (correction) => `Permintaan koreksi #${correction.ticket_id}`,
  },
};

function get(action) {
  return ACTIONS[action] || null;
}

module.exports = { ACTIONS, get };

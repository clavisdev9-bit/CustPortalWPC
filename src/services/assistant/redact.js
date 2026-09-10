// Membuang field yang tidak perlu dilihat model sebelum hasil tool masuk konteks (section 7.2
// poin 6, Fase 1 poin 8). Dijalankan SEBELUM summarize.
//
// Dua alasan, keduanya berlaku meski modelnya self-host:
//
// 1. Data ini tidak menambah kemampuan menjawab. Alamat dan nomor telepon pelanggan tidak
//    membuat jawaban tentang invoice jadi lebih benar, tapi tetap ikut terkirim, tersimpan di
//    log provider, dan -- pada provider cloud -- keluar dari kendali kita. Yang tidak dikirim
//    tidak bisa bocor.
// 2. Field pegawai internal Odoo (user_id, create_uid) adalah nama orang di sisi vendor.
//    Pelanggan tidak berhak tahu siapa yang menyentuh record mereka, dan model kecil dengan
//    senang hati akan menyebutkannya kalau ada di konteks.
//
// Yang TIDAK dibuang: nama produk, nomor dokumen, status, jumlah, tanggal. Itu justru jawabannya.

const REDACTED_KEYS = new Set([
  // kontak
  'email', 'email_from', 'partner_email', 'phone', 'mobile', 'partner_phone', 'website',
  // alamat
  'street', 'street2', 'city', 'zip', 'state_id', 'country_id', 'contact_address',
  'partner_address', 'partner_shipping_address', 'partner_invoice_address',
  // identitas pajak/badan usaha
  'vat', 'ref', 'company_registry',
  // pegawai internal di sisi vendor
  'user_id', 'create_uid', 'write_uid', 'activity_user_id', 'team_id', 'medium_id', 'source_id',
  // catatan internal
  'internal_note', 'internal_notes', 'note_internal',
]);

// Identitas juga dibuang dari HASIL, bukan hanya dari argumen tool (I-1 menutup arah masuk;
// ini menutup arah keluar). Model yang pernah melihat "partner_id: 42" akan mencoba memakainya,
// dan permintaan seperti "tampilkan invoice partner 43" jadi terasa masuk akal baginya.
const IDENTITY_KEYS = new Set(['partner_id', 'commercial_partner_id', 'company_id']);

const MAX_DEPTH = 6;

function scrub(value, depth = 0) {
  if (depth > MAX_DEPTH) return null;
  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1));
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;

  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (REDACTED_KEYS.has(key) || IDENTITY_KEYS.has(key)) continue;
    out[key] = scrub(item, depth + 1);
  }
  return out;
}

// `tool.redact` (opsional, section 7.1) berjalan SETELAH sapuan generik, bukan menggantikannya:
// sebuah tool boleh memperketat, tidak boleh melonggarkan.
function apply(tool, result) {
  const scrubbed = scrub(result);
  return typeof tool.redact === 'function' ? tool.redact(scrubbed) : scrubbed;
}

module.exports = { apply, scrub, REDACTED_KEYS, IDENTITY_KEYS };

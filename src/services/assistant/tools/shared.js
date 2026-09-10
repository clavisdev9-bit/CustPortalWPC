// Pembantu bersama untuk `summarize`. Semua peringkasan terjadi DI SINI, di kode -- bukan dengan
// mengirim list mentah ke model dan berharap ia meringkas dengan benar (anti-pattern section 16).
// Dua alasan: model kecil salah menjumlah dengan meyakinkan, dan list mentah adalah pos biaya
// token terbesar fitur ini.
const { z } = require('zod');

// Batas jumlah baris yang disebutkan namanya di dalam ringkasan. Sisanya dilaporkan sebagai
// jumlah ("...dan 12 lainnya"), bukan dibuang diam-diam -- model harus tahu ada lebih banyak
// data supaya tidak menjawab seolah daftarnya sudah lengkap.
const SAMPLE = 5;

// LLM sering mengirim id sebagai string ("42") meski skemanya bertipe number. Coerce di sini
// jauh lebih murah daripada satu putaran tool tambahan hanya untuk memperbaiki tipe.
// z.coerce.number() tetap menghasilkan ZodNumber, jadi toolRegistry.fieldToJsonSchema tetap
// melaporkannya sebagai {type:'number'} ke model.
function odooId(description) {
  return z.coerce.number().int().positive().describe(description);
}

function currencyOf(record) {
  return record?.currency_id?.[1] || '';
}

function money(amount, currency) {
  if (amount === null || amount === undefined) return '-';
  return `${amount} ${currency || ''}`.trim();
}

// "3 dari 15" saat terpotong, "3" saat tidak. Menyatakan keterpotongan secara eksplisit adalah
// syarat aturan "tanpa hasil tool, tanpa angka" tetap bermakna: model yang mengira ia melihat
// seluruh daftar akan menjawab pertanyaan agregat dari potongan.
function sampled(items, render) {
  const shown = items.slice(0, SAMPLE).map(render).join('; ');
  const rest = items.length - SAMPLE;
  return rest > 0 ? `${shown}; dan ${rest} lainnya` : shown;
}

// Deskripsi tiket dan komentar di Odoo tersimpan sebagai HTML. Mengirim markup-nya utuh ke model
// membakar token untuk tag yang tidak berarti apa-apa, dan membuka satu celah lagi: markup bisa
// dipakai menyamarkan teks perintah agar tidak terlihat saat ditinjau manusia. Yang dibutuhkan
// model hanya teksnya.
function stripHtml(html, maxChars = 500) {
  if (!html || typeof html !== 'string') return '';
  const text = html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|tr)>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

module.exports = { SAMPLE, odooId, currencyOf, money, sampled, stripHtml };

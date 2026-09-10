// Merender prompt dari assistant_prompts (section 9). Tidak ada teks prompt sebagai literal di
// file ini -- itu anti-pattern section 16, dan alasan tabelnya ada.
const ApiError = require('../../utils/ApiError');
const assistantConfigRepository = require('../../repositories/assistantConfigRepository');

// SENGAJA tanpa cache, tidak seperti assistantConfigService. Acceptance criteria Fase 1:
// "Mengubah prompt di DB mengubah perilaku tanpa restart" -- dengan TTL 60 detik, perilakunya
// jadi "tanpa restart, tapi tunggu sebentar", yang mustahil dijelaskan ke admin yang sedang
// menguji perubahan prompt. Satu SELECT kecil per pesan tidak berarti apa-apa di sebelah satu
// panggilan LLM dan beberapa round-trip XML-RPC ke Odoo.

// Satu kali sapu, dengan nilai diambil dari peta -- BUKAN replace berantai. Kalau nama seorang
// pengguna kebetulan memuat "{{now}}", replace berantai akan mengganti isinya juga; sapuan
// tunggal tidak pernah memeriksa ulang teks yang baru disisipkan.
function render(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) =>
    (Object.prototype.hasOwnProperty.call(values, key) ? String(values[key] ?? '') : match)
  );
}

async function load(locale, key) {
  const prompts = await assistantConfigRepository.findActivePrompts(locale);
  const body = prompts[key];
  if (!body) {
    // Tidak jatuh ke locale lain dan tidak ke teks bawaan: prompt sistem yang hilang berarti
    // asisten akan berjalan tanpa aturan keamanannya sama sekali. Lebih baik mati.
    throw new ApiError(
      503,
      'assistant_not_configured',
      `No active assistant prompt for key "${key}" in locale "${locale}" -- run the seeds or activate a version`
    );
  }
  return body;
}

async function buildSystemPrompt({ locale, userName, companyName, currentRoute, now }) {
  const template = await load(locale, 'system');
  return render(template, {
    user_name: userName,
    company_name: companyName,
    current_route: currentRoute,
    now,
  });
}

function getRefusal(locale) {
  return load(locale, 'refusal');
}

// Dipakai saat model tidak menghasilkan teks sama sekali. SENGAJA terpisah dari getRefusal:
// "saya tidak punya datanya" dan "jawaban saya gagal terbentuk" adalah dua hal berbeda, dan
// mencampurnya membuat asisten menyalahkan pertanyaan pengguna atas kegagalan teknisnya sendiri.
function getInterrupted(locale) {
  return load(locale, 'interrupted');
}

// Starters bersifat kosmetik: JSON rusak yang disimpan admin tidak boleh membuat widget gagal
// dibuka, jadi ini satu-satunya prompt yang boleh gagal diam-diam menjadi array kosong.
async function getStarters(locale) {
  const prompts = await assistantConfigRepository.findActivePrompts(locale);
  if (!prompts.starters) return [];
  try {
    const parsed = JSON.parse(prompts.starters);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string').slice(0, 6) : [];
  } catch {
    console.error(`assistant_prompts starters for locale "${locale}" is not valid JSON -- ignoring`);
    return [];
  }
}

module.exports = { buildSystemPrompt, getRefusal, getInterrupted, getStarters, render };

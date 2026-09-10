// Fase 0 gerbang keputusan (Docs/CR/customer_portal_ai_assistant.md section 11): measures whether
// the configured model picks the right tool (or correctly picks none) on 30 labeled conversational
// Indonesian questions. Run: `node scripts/eval-assistant.js`. Does not require an authenticated
// user -- it evaluates the model against the full, unfiltered tool catalog
// (Docs/CR/assistant-eval-set.json), independent of any one customer's RBAC grants.
//
// Sejak Fase 1 script ini MEMBACA portal DB untuk satu hal: prompt sistemnya. Prompt tidak lagi
// ada sebagai literal di JS (anti-pattern section 16), dan meng-eval model dengan prompt tiruan
// akan mengukur sesuatu yang bukan perilaku produksi. Jalankan `npm run migrate` lebih dulu.
const fs = require('fs');
const path = require('path');
const { getProvider } = require('../src/services/assistant/providers');
const assistantConfigService = require('../src/services/assistantConfigService');
const { describeAllTools } = require('../src/services/assistant/toolRegistry');
const promptBuilder = require('../src/services/assistant/promptBuilder');
const pool = require('../src/db/pool');

const EVAL_SET_PATH = path.join(__dirname, '..', 'Docs', 'CR', 'assistant-eval-set.json');
const ACCURACY_GATE = 0.9;
const MAX_RATE_LIMIT_RETRIES = 5;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Dua kegagalan yang TIDAK berkata apa-apa tentang kualitas pemilihan tool, dan karena itu tidak
// boleh menjatuhkan seluruh eval run:
//   - 429: free-tier provider (gemini, per D1) membatasi pada jendela pendek yang pulih sendiri.
//   - 503 overloaded: model sedang kelebihan beban ("high demand" / UNAVAILABLE). Ini yang paling
//     sering muncul saat mengevaluasi 30 kasus berturut-turut ke provider bersama.
// Membiarkan salah satunya menggagalkan run berarti gerbang keputusan section 11 akan tampak
// GAGAL karena cuaca infrastruktur, bukan karena modelnya memang tidak cukup baik.
const TRANSIENT_CODES = new Set(['assistant_rate_limited', 'assistant_overloaded', 'assistant_timeout']);

async function chatWithRetry(provider, args) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await provider.chat(args);
    } catch (err) {
      if (!TRANSIENT_CODES.has(err.code) || attempt >= MAX_RATE_LIMIT_RETRIES) throw err;
      const waitMs = 15000 * (attempt + 1);
      console.log(`  ${err.code}, menunggu ${waitMs / 1000}s sebelum percobaan ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES}...`);
      await sleep(waitMs);
    }
  }
}

async function run() {
  // Config diambil dari rantai presedensi yang SAMA dipakai produksi (assistant_settings ->
  // env.assistant), bukan langsung dari env. Sejak Fase 1 baris DB menimpa env, jadi membaca env
  // di sini berarti eval bisa mengukur model yang sama sekali berbeda dari yang benar-benar
  // melayani pengguna -- gerbang keputusan yang mengukur hal yang salah lebih buruk daripada
  // tidak ada gerbang.
  //
  // Argumen pertama menimpa nama model, untuk membandingkan beberapa model tanpa mengubah
  // konfigurasi yang sedang dipakai:  node scripts/eval-assistant.js minimax-m3:cloud
  const resolved = await assistantConfigService.resolve(null);
  const modelOverride = process.argv[2] || null;

  const cases = JSON.parse(fs.readFileSync(EVAL_SET_PATH, 'utf8'));
  const tools = describeAllTools();
  const provider = getProvider(resolved.provider);
  const config = {
    baseUrl: resolved.baseUrl,
    apiKey: resolved.apiKey,
    model: modelOverride || resolved.model,
    timeoutMs: resolved.timeoutMs,
    temperature: 0.2,
    maxOutputTokens: 512,
  };
  const prompt = await promptBuilder.buildSystemPrompt({
    locale: 'id',
    userName: 'Eval Customer',
    companyName: 'Eval Co',
    currentRoute: '/dashboard',
    now: new Date().toISOString(),
  });

  console.log(`provider=${resolved.provider}  model=${config.model}  tools=${tools.length}  cases=${cases.length}\n`);

  let correct = 0;
  const mismatches = [];

  for (const [index, testCase] of cases.entries()) {
    const messages = [
      { role: 'system', content: prompt },
      { role: 'user', content: testCase.message },
    ];

    let response;
    try {
      response = await chatWithRetry(provider, { messages, tools, config });
    } catch (err) {
      console.error(`[${index + 1}/${cases.length}] provider error: ${err.message}`);
      mismatches.push({ ...testCase, actualTool: 'ERROR' });
      continue;
    }

    const actualTool = response.toolCalls?.[0]?.name || null;
    const ok = actualTool === testCase.expectedTool;
    if (ok) correct += 1;
    else mismatches.push({ ...testCase, actualTool });

    const label = ok ? 'PASS' : 'FAIL';
    console.log(`[${index + 1}/${cases.length}] ${label}  expected=${testCase.expectedTool ?? 'none'}  actual=${actualTool ?? 'none'}  "${testCase.message}"`);
  }

  const accuracy = correct / cases.length;
  console.log(`\nAccuracy: ${correct}/${cases.length} (${(accuracy * 100).toFixed(1)}%)`);

  if (mismatches.length) {
    console.log('\nMismatches:');
    for (const m of mismatches) {
      console.log(`  - "${m.message}" -> expected ${m.expectedTool ?? 'none'}, got ${m.actualTool ?? 'none'}`);
    }
  }

  console.log(
    accuracy >= ACCURACY_GATE
      ? `\nGERBANG KEPUTUSAN: PASS (>= ${ACCURACY_GATE * 100}%). Boleh lanjut ke Fase 1.`
      : `\nGERBANG KEPUTUSAN: FAIL (< ${ACCURACY_GATE * 100}%). Naikkan ukuran model dan ulangi -- jangan lanjut ke Fase 1 dulu.`
  );
}

// pool.end() supaya proses keluar sendiri: tanpa itu koneksi pg yang menganggur menahan event
// loop tetap hidup dan script tampak menggantung setelah mencetak hasilnya.
run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

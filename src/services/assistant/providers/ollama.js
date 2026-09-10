// Adapter for a self-hosted Ollama server (D1: production target, Qwen3 family). Two entry
// points with one normalized contract: chat() for the eval script and any non-streaming caller,
// chatStream() for the SSE endpoint (Fase 1 poin 6).
const { iterateLines, parseJsonLine, assertOk, withTimeout, unreachable } = require('./streamUtils');

const PROVIDER_NAME = 'Ollama';

function toOllamaTools(tools) {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.jsonSchema,
    },
  }));
}

// Ollama returns tool_calls[].function.arguments already parsed as an object for most models,
// but some return it as a JSON string -- normalize both.
function parseArgs(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function normalizeToolCalls(rawCalls) {
  return (rawCalls || []).map((call) => ({
    name: call.function.name,
    args: parseArgs(call.function.arguments),
  }));
}

// Bentuk pesan internal (assistantService) memakai tool_calls: [{name, args}] -- bentuk
// ternormalisasi milik kita sendiri, bukan milik provider mana pun. Ollama mengharapkan
// tool_calls: [{function: {name, arguments}}], dan menolak seluruh permintaan dengan HTTP 500
// kalau menerima bentuk kita.
//
// Ini baru terpicu pada iterasi KEDUA loop tool -- giliran pertama tidak punya riwayat assistant
// dengan tool_calls, jadi ia lolos. Akibatnya setiap percakapan yang benar-benar memakai tool
// gagal tepat setelah tool-nya berhasil dijalankan, yaitu di titik model seharusnya membaca
// hasilnya. claude.js dan gemini.js sudah punya konverternya masing-masing sejak awal; yang ini
// terlewat, dan tidak terlihat karena check-assistant-flow.js men-stub provider.
function toOllamaMessages(messages) {
  return messages.map((msg) => {
    if (msg.role === 'tool') {
      // tool_name membantu model mencocokkan hasil dengan panggilannya saat ada beberapa tool
      // dipanggil dalam satu giliran. Versi Ollama lama mengabaikannya, bukan menolaknya.
      return { role: 'tool', content: msg.content || '', tool_name: msg.name };
    }
    if (msg.role === 'assistant' && msg.tool_calls?.length) {
      return {
        role: 'assistant',
        content: msg.content || '',
        tool_calls: msg.tool_calls.map((call) => ({
          function: { name: call.name, arguments: call.args || {} },
        })),
      };
    }
    return { role: msg.role, content: msg.content || '' };
  });
}

function requestBody({ messages, tools, config, stream }) {
  return JSON.stringify({
    model: config.model,
    messages: toOllamaMessages(messages),
    tools: tools.length ? toOllamaTools(tools) : undefined,
    stream,
    options: { temperature: config.temperature, num_predict: config.maxOutputTokens },
  });
}

async function post({ messages, tools, config, stream }) {
  const { signal, clear } = withTimeout(config.timeoutMs);
  // Daemon lokal tidak butuh auth apa pun, jadi header ini hanya ditambahkan kalau apiKey
  // terisi -- yang hanya terjadi lewat Target 'cloud'/'auto+key terisi' (Konfigurasi Provider
  // AI, assistantConfigService.resolveOllamaProviderFields). Ollama Cloud (ollama.com) menolak
  // permintaan tanpa header ini.
  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  try {
    const res = await fetch(`${config.baseUrl}/api/chat`, {
      method: 'POST',
      headers,
      body: requestBody({ messages, tools, config, stream }),
      signal,
    });
    await assertOk(res, PROVIDER_NAME);
    return { res, clear };
  } catch (err) {
    clear();
    if (err.status) throw err; // ApiError dari assertOk
    throw unreachable(err, `Ollama at ${config.baseUrl}`);
  }
}

async function chat({ messages, tools, config }) {
  const { res, clear } = await post({ messages, tools, config, stream: false });
  try {
    const body = await res.json();
    const message = body.message || {};
    return {
      content: message.content || '',
      toolCalls: normalizeToolCalls(message.tool_calls),
      usage: {
        promptTokens: body.prompt_eval_count || 0,
        completionTokens: body.eval_count || 0,
      },
    };
  } finally {
    clear();
  }
}

// NDJSON: satu objek JSON per baris. Teks tiba sebagai potongan di message.content; tool_calls
// tiba utuh dalam satu potongan (Ollama tidak memecah argumen tool antar chunk seperti
// Anthropic), jadi ia cukup dikumpulkan apa adanya.
async function chatStream({ messages, tools, config, onDelta }) {
  const { res, clear } = await post({ messages, tools, config, stream: true });
  let content = '';
  const toolCalls = [];
  const usage = { promptTokens: 0, completionTokens: 0 };

  try {
    for await (const line of iterateLines(res)) {
      const chunk = parseJsonLine(line);
      if (!chunk) continue;

      const delta = chunk.message?.content;
      if (delta) {
        content += delta;
        onDelta(delta);
      }
      if (chunk.message?.tool_calls) {
        toolCalls.push(...normalizeToolCalls(chunk.message.tool_calls));
      }
      if (chunk.done) {
        usage.promptTokens = chunk.prompt_eval_count || 0;
        usage.completionTokens = chunk.eval_count || 0;
      }
    }
  } finally {
    clear();
  }

  return { content, toolCalls, usage };
}

module.exports = { chat, chatStream };

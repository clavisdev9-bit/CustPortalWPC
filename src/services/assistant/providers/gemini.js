// Adapter for Gemini's free tier (D1: POC only, synthetic data -- free-tier prompts may be used
// by Google to train their models, so this must never be pointed at real customer data).
const ApiError = require('../../../utils/ApiError');
const { iterateSseData, parseJsonLine, assertOk, withTimeout, unreachable } = require('./streamUtils');

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';
const PROVIDER_NAME = 'Gemini';

// Gemini has no 'tool' role and no separate system-message slot in the contents array: the system
// prompt becomes systemInstruction, 'assistant' becomes 'model', and a prior tool result becomes a
// user-role functionResponse part so the model sees it as new input rather than its own words.
function toGeminiContents(messages) {
  const contents = [];
  for (const msg of messages) {
    if (msg.role === 'system') continue;
    if (msg.role === 'tool') {
      contents.push({
        role: 'user',
        parts: [{ functionResponse: { name: msg.name, response: { result: msg.content } } }],
      });
      continue;
    }
    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content || '' }],
    });
  }
  return contents;
}

function toGeminiTools(tools) {
  if (!tools.length) return undefined;
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.jsonSchema,
      })),
    },
  ];
}

// Kunci API dikirim lewat header x-goog-api-key, bukan query string `?key=`. Keduanya diterima
// Gemini, tapi query string ikut tercatat di access log proxy/CDN mana pun yang dilewati --
// tempat yang sangat buruk untuk sebuah kredensial.
async function post({ messages, tools, config, stream }) {
  if (!config.apiKey) {
    throw new ApiError(503, 'assistant_not_configured', 'ASSISTANT_API_KEY is required for the gemini provider');
  }
  const systemMessage = messages.find((m) => m.role === 'system');
  const endpoint = stream
    ? `${API_ROOT}/models/${config.model}:streamGenerateContent?alt=sse`
    : `${API_ROOT}/models/${config.model}:generateContent`;
  const { signal, clear } = withTimeout(config.timeoutMs);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
      body: JSON.stringify({
        systemInstruction: systemMessage ? { parts: [{ text: systemMessage.content }] } : undefined,
        contents: toGeminiContents(messages),
        tools: toGeminiTools(tools),
        generationConfig: {
          temperature: config.temperature,
          maxOutputTokens: config.maxOutputTokens,
        },
      }),
      signal,
    });
    // assertOk membedakan 429 dari error lain: rate limit free tier rutin terjadi (D1) dan
    // pemanggil perlu bisa membedakan "provider membatasi kita" dari "provider rusak".
    await assertOk(res, PROVIDER_NAME);
    return { res, clear };
  } catch (err) {
    clear();
    if (err.status) throw err;
    throw unreachable(err, 'the Gemini API');
  }
}

function partsOf(chunk) {
  return chunk.candidates?.[0]?.content?.parts || [];
}

async function chat({ messages, tools, config }) {
  const { res, clear } = await post({ messages, tools, config, stream: false });
  try {
    const body = await res.json();
    const parts = partsOf(body);
    return {
      content: parts.filter((p) => p.text).map((p) => p.text).join(''),
      toolCalls: parts
        .filter((p) => p.functionCall)
        .map((p) => ({ name: p.functionCall.name, args: p.functionCall.args || {} })),
      usage: {
        promptTokens: body.usageMetadata?.promptTokenCount || 0,
        completionTokens: body.usageMetadata?.candidatesTokenCount || 0,
      },
    };
  } finally {
    clear();
  }
}

// Setiap potongan SSE adalah GenerateContentResponse utuh, bukan delta bertingkat: teksnya
// bertambah sepotong per chunk, sementara functionCall selalu tiba lengkap dalam satu part.
// usageMetadata dikirim ulang di setiap chunk dengan nilai kumulatif, jadi yang terakhir menang.
async function chatStream({ messages, tools, config, onDelta }) {
  const { res, clear } = await post({ messages, tools, config, stream: true });
  let content = '';
  const toolCalls = [];
  const usage = { promptTokens: 0, completionTokens: 0 };

  try {
    for await (const data of iterateSseData(res)) {
      const chunk = parseJsonLine(data);
      if (!chunk) continue;

      for (const part of partsOf(chunk)) {
        if (part.text) {
          content += part.text;
          onDelta(part.text);
        }
        if (part.functionCall) {
          toolCalls.push({ name: part.functionCall.name, args: part.functionCall.args || {} });
        }
      }
      if (chunk.usageMetadata) {
        usage.promptTokens = chunk.usageMetadata.promptTokenCount || usage.promptTokens;
        usage.completionTokens = chunk.usageMetadata.candidatesTokenCount || usage.completionTokens;
      }
    }
  } finally {
    clear();
  }

  return { content, toolCalls, usage };
}

module.exports = { chat, chatStream };

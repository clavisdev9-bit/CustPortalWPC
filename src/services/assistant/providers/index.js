// Factory keyed off assistant_settings.provider / ASSISTANT_PROVIDER (D1: provider abstraction).
// Every adapter exposes the same normalized contract so assistantService never branches on
// provider name:
//
//   chat({ messages, tools, config })                    -> { content, toolCalls, usage }
//   chatStream({ messages, tools, config, onDelta })     -> { content, toolCalls, usage }
//
// Keduanya mengembalikan bentuk yang sama; chatStream juga memanggil onDelta(text) setiap kali
// potongan teks tiba. Yang mengalir hanya teks -- tool call selalu dikembalikan utuh di akhir,
// karena tool tidak boleh dieksekusi setengah jadi.
const ollama = require('./ollama');
const gemini = require('./gemini');
const claude = require('./claude');
const ApiError = require('../../../utils/ApiError');

const PROVIDERS = { ollama, gemini, claude };

function getProvider(name) {
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new ApiError(503, 'assistant_not_configured', `Unknown assistant provider: ${name}`);
  }
  return provider;
}

// Jalur tunggal untuk orkestrator: kalau adapter tidak punya chatStream, jawabannya dikirim
// sebagai satu delta besar di akhir. Widget-nya tetap bekerja -- hanya tidak terlihat mengetik.
// Ini menjaga adapter baru tetap bisa ditambahkan dengan satu method saja.
async function chat(provider, { messages, tools, config, onDelta }) {
  if (typeof provider.chatStream === 'function' && typeof onDelta === 'function') {
    return provider.chatStream({ messages, tools, config, onDelta });
  }
  const response = await provider.chat({ messages, tools, config });
  if (onDelta && response.content) onDelta(response.content);
  return response;
}

module.exports = { getProvider, chat };

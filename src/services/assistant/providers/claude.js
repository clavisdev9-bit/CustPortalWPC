// Adapter for the Anthropic Messages API (raw fetch, no SDK -- matches ollama.js/gemini.js).
const ApiError = require('../../../utils/ApiError');
const { iterateSseData, parseJsonLine, assertOk, withTimeout, unreachable } = require('./streamUtils');

const API_ROOT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const PROVIDER_NAME = 'Claude';

// Claude has no 'tool' role: a prior tool call becomes a tool_use block on the assistant turn,
// and its result becomes a tool_result block on the NEXT user turn, matched by tool_use_id.
// The internal message shape (assistantService.js) carries neither id -- tool_calls are plain
// {name, args} and tool results are separate {role:'tool', name, content} entries that always
// follow their assistant turn in the same order, so we synthesize ids and pair them by position.
function toClaudeMessages(messages) {
  const claudeMessages = [];
  const pendingToolUseIds = [];
  let toolResultBlocks = [];

  function flushToolResults() {
    if (toolResultBlocks.length) {
      claudeMessages.push({ role: 'user', content: toolResultBlocks });
      toolResultBlocks = [];
    }
  }

  messages.forEach((msg, index) => {
    if (msg.role === 'system') return;

    if (msg.role === 'tool') {
      const toolUseId = pendingToolUseIds.shift() || `toolu_unmatched_${index}`;
      toolResultBlocks.push({ type: 'tool_result', tool_use_id: toolUseId, content: msg.content || '' });
      return;
    }

    flushToolResults();

    if (msg.role === 'assistant') {
      const content = [];
      if (msg.content) content.push({ type: 'text', text: msg.content });
      for (const call of msg.tool_calls || []) {
        const id = `toolu_${index}_${pendingToolUseIds.length}`;
        pendingToolUseIds.push(id);
        content.push({ type: 'tool_use', id, name: call.name, input: call.args || {} });
      }
      claudeMessages.push({ role: 'assistant', content: content.length ? content : [{ type: 'text', text: '' }] });
      return;
    }

    claudeMessages.push({ role: 'user', content: msg.content || '' });
  });

  flushToolResults();
  return claudeMessages;
}

function toClaudeTools(tools) {
  if (!tools.length) return undefined;
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.jsonSchema,
  }));
}

async function post({ messages, tools, config, stream }) {
  if (!config.apiKey) {
    throw new ApiError(503, 'assistant_not_configured', 'ASSISTANT_API_KEY is required for the claude provider');
  }
  const systemMessage = messages.find((m) => m.role === 'system');
  const { signal, clear } = withTimeout(config.timeoutMs);

  try {
    const res = await fetch(API_ROOT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.maxOutputTokens,
        system: systemMessage ? systemMessage.content : undefined,
        messages: toClaudeMessages(messages),
        tools: toClaudeTools(tools),
        temperature: config.temperature,
        stream: stream || undefined,
      }),
      signal,
    });
    await assertOk(res, PROVIDER_NAME);
    return { res, clear };
  } catch (err) {
    clear();
    if (err.status) throw err; // ApiError dari assertOk / apiKey check
    throw unreachable(err, 'the Anthropic API');
  }
}

async function chat({ messages, tools, config }) {
  const { res, clear } = await post({ messages, tools, config, stream: false });
  try {
    const body = await res.json();
    const blocks = body.content || [];
    return {
      content: blocks.filter((b) => b.type === 'text').map((b) => b.text).join(''),
      toolCalls: blocks
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({ name: b.name, args: b.input || {} })),
      usage: {
        promptTokens: body.usage?.input_tokens || 0,
        completionTokens: body.usage?.output_tokens || 0,
      },
    };
  } finally {
    clear();
  }
}

// Anthropic mengalirkan argumen tool sebagai potongan JSON mentah (input_json_delta), bukan
// objek utuh: sebuah blok tool_use dibuka dengan nama tapi input kosong, lalu argumennya tiba
// sepotong-sepotong sebagai teks. Jadi potongan dikumpulkan per index blok dan baru di-parse
// saat bloknya ditutup -- mem-parse lebih awal selalu gagal, karena JSON-nya memang belum utuh.
async function chatStream({ messages, tools, config, onDelta }) {
  const { res, clear } = await post({ messages, tools, config, stream: true });
  let content = '';
  const blocks = new Map(); // index -> { type, name, jsonBuffer }
  const toolCalls = [];
  const usage = { promptTokens: 0, completionTokens: 0 };

  function closeBlock(index) {
    const block = blocks.get(index);
    if (!block || block.type !== 'tool_use') return;
    let args = {};
    if (block.jsonBuffer) {
      try {
        args = JSON.parse(block.jsonBuffer);
      } catch {
        // Argumen yang tidak bisa di-parse diteruskan sebagai objek kosong, bukan dibuang:
        // toolRegistry.dispatch akan menolaknya lewat .strict()/skema Zod dengan pesan yang
        // bisa dibaca model, dan itu jauh lebih berguna daripada tool call yang hilang tanpa jejak.
        console.error(`Claude sent unparseable tool arguments for "${block.name}": ${block.jsonBuffer.slice(0, 200)}`);
      }
    }
    toolCalls.push({ name: block.name, args });
    blocks.delete(index);
  }

  try {
    for await (const data of iterateSseData(res)) {
      const event = parseJsonLine(data);
      if (!event) continue;

      switch (event.type) {
        case 'message_start':
          usage.promptTokens = event.message?.usage?.input_tokens || 0;
          break;
        case 'content_block_start':
          blocks.set(event.index, {
            type: event.content_block?.type,
            name: event.content_block?.name,
            jsonBuffer: '',
          });
          break;
        case 'content_block_delta': {
          if (event.delta?.type === 'text_delta') {
            content += event.delta.text;
            onDelta(event.delta.text);
          } else if (event.delta?.type === 'input_json_delta') {
            const block = blocks.get(event.index);
            if (block) block.jsonBuffer += event.delta.partial_json || '';
          }
          break;
        }
        case 'content_block_stop':
          closeBlock(event.index);
          break;
        case 'message_delta':
          usage.completionTokens = event.usage?.output_tokens || 0;
          break;
        default:
          break;
      }
    }
  } finally {
    clear();
  }

  return { content, toolCalls, usage };
}

module.exports = { chat, chatStream };

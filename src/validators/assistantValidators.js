const { z } = require('zod');

// Fase 1: klien TIDAK lagi mengirim riwayatnya sendiri. Riwayat hidup di assistant_messages dan
// dibaca server dari conversation_id -- riwayat yang dikirim klien adalah riwayat yang bisa
// dikarang klien, dan itu jalur langsung untuk menyuntik "hasil tool" palsu ke dalam konteks model.
const chatSchema = z.object({
  conversation_id: z.string().uuid().optional(),
  message: z.string().min(1).max(2000),
  locale: z.enum(['id', 'en']).optional(),
  route: z.string().max(200).optional(),
});

const feedbackSchema = z.object({
  rating: z.union([z.literal(1), z.literal(-1)]),
  reason: z.string().max(1000).optional(),
});

// --------------------------------------------------------------- admin --

const settingsSchema = z.object({
  odoo_connection_id: z.string().uuid().nullable().optional(),
  provider: z.enum(['ollama', 'gemini', 'claude']).optional(),
  model: z.string().min(1).max(120).optional(),
  base_url: z.string().max(255).nullable().optional(),
  // Plaintext di sini, terenkripsi sebelum menyentuh DB (adminAssistantController). Tidak pernah
  // dikembalikan lagi oleh endpoint GET mana pun.
  api_key: z.string().max(500).nullable().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_output_tokens: z.number().int().min(64).max(8192).optional(),
  max_tool_iterations: z.number().int().min(1).max(10).optional(),
  history_window: z.number().int().min(2).max(50).optional(),
  daily_message_quota: z.number().int().min(1).max(10000).optional(),
  burst_per_minute: z.number().int().min(1).max(60).optional(),
  default_locale: z.enum(['id', 'en']).optional(),
  enabled: z.boolean().optional(),
});

// Konfigurasi Provider AI (My Account > Setting): satu baris per provider, terpisah dari
// settingsSchema di atas yang cuma menyimpan provider AKTIF + parameter bersama (kuota/temperature).
// ollama_target/ollama_model_manual/api_key_cloud/base_url_cloud hanya berarti untuk provider
// 'ollama' -- dibiarkan optional untuk claude/gemini alih-alih ditolak, supaya payload yang sama
// dari form Ollama tidak perlu dicabangkan sebelum dikirim.
const providerConfigSchema = z.object({
  provider: z.enum(['claude', 'gemini', 'ollama']),
  model: z.string().max(120).nullable().optional(),
  api_key: z.string().max(500).nullable().optional(),
  base_url: z.string().max(255).nullable().optional(),
  ollama_target: z.enum(['auto', 'local', 'cloud']).optional(),
  ollama_model_manual: z.string().max(120).nullable().optional(),
  api_key_cloud: z.string().max(500).nullable().optional(),
  base_url_cloud: z.string().max(255).nullable().optional(),
});

const promptSchema = z.object({
  key: z.enum(['system', 'refusal', 'interrupted', 'starters', 'ticket_intake']),
  locale: z.enum(['id', 'en']),
  body: z.string().min(1).max(20000),
});

const toolOverrideSchema = z.object({
  odoo_connection_id: z.string().uuid().nullable().optional(),
  tool_name: z.string().min(1).max(60),
  permission_code: z.string().min(1).max(60),
  description_override: z.string().max(2000).nullable().optional(),
  enabled: z.boolean(),
});

module.exports = { chatSchema, feedbackSchema, settingsSchema, providerConfigSchema, promptSchema, toolOverrideSchema };

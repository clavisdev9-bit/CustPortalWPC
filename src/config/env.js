require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

module.exports = {
  port: process.env.PORT || 3000,
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || '15m',
  refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30),
  encryptionKey: required('ENCRYPTION_KEY'),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:5173',
  // BUG-23: only needed when the backend sits behind something that rewrites the Host header
  // before Express sees it (e.g. Vite's dev proxy with changeOrigin: true -- see vite.config.js).
  // In that setup req.get('host') reads the proxy TARGET's host ("localhost:<port>"), which is
  // useless for a URL Odoo (running on a different machine) needs to call back into. A real
  // production reverse proxy (system.md section 14) normally preserves the original Host header,
  // so this only needs to be set for this dev-proxy-in-front-of-a-public-IP topology.
  publicApiBaseUrl: process.env.PUBLIC_API_BASE_URL || null,
  smtp: {
    host: process.env.SMTP_HOST || null,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || null,
    pass: process.env.SMTP_PASS || null,
    from: process.env.SMTP_FROM || 'no-reply@custportal.local',
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || null,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || null,
    redirectUri: process.env.GOOGLE_REDIRECT_URI || null,
    workspaceDomain: process.env.GOOGLE_WORKSPACE_HD || null,
  },
  otp: {
    length: Number(process.env.OTP_LENGTH || 6),
    ttlMinutes: Number(process.env.OTP_TTL_MINUTES || 10),
    maxAttempts: Number(process.env.OTP_MAX_ATTEMPTS || 5),
    maxRequestsPerWindow: Number(process.env.OTP_MAX_REQUESTS_PER_WINDOW || 3),
    requestWindowMinutes: Number(process.env.OTP_REQUEST_WINDOW_MINUTES || 15),
    resendCooldownSeconds: Number(process.env.OTP_RESEND_COOLDOWN_SECONDS || 30),
  },
  // AI Assistant, Docs/CR/customer_portal_ai_assistant.md. This is the LAST layer of the
  // precedence chain in section 6.2 -- assistant_settings rows (per-connection, then global)
  // override anything here, and assistantConfigService refuses to invent a value that no layer
  // supplied. So every knob assistant_settings has a DEFAULT for needs a counterpart here:
  // with no settings row in the DB at all (the state right after 0010_assistant.sql runs), env
  // is the only layer left, and a missing value would take the feature down with a 503.
  assistant: {
    enabled: process.env.ASSISTANT_ENABLED === 'true',
    provider: process.env.ASSISTANT_PROVIDER || 'ollama',
    baseUrl: process.env.ASSISTANT_BASE_URL || 'http://localhost:11434',
    apiKey: process.env.ASSISTANT_API_KEY || null,
    model: process.env.ASSISTANT_MODEL || 'qwen3:8b',
    timeoutMs: Number(process.env.ASSISTANT_TIMEOUT_MS || 30000),
    embeddingModel: process.env.ASSISTANT_EMBEDDING_MODEL || null,
    temperature: Number(process.env.ASSISTANT_TEMPERATURE || 0.2),
    maxOutputTokens: Number(process.env.ASSISTANT_MAX_OUTPUT_TOKENS || 1024),
    maxToolIterations: Number(process.env.ASSISTANT_MAX_TOOL_ITERATIONS || 5),
    historyWindow: Number(process.env.ASSISTANT_HISTORY_WINDOW || 10),
    dailyMessageQuota: Number(process.env.ASSISTANT_DAILY_MESSAGE_QUOTA || 100),
    burstPerMinute: Number(process.env.ASSISTANT_BURST_PER_MINUTE || 6),
    defaultLocale: process.env.ASSISTANT_DEFAULT_LOCALE || 'id',
  },
};

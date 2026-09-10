const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const authService = require('./authService');
const portalUserRepository = require('../repositories/portalUserRepository');

const SCOPES = ['openid', 'email', 'profile'];
const STATE_TTL = '5m';

// Single-use, short-lived, in-memory: bridges the redirect-based OAuth flow into an SPA that
// expects a JSON API response. Tokens never sit in a URL or browser history -- the callback
// hands the browser this opaque code instead, and the frontend immediately exchanges it for a
// real session via POST. In-memory is fine at this scale (same assumption the rest of this
// codebase makes, e.g. the notification poller) but won't survive a restart or a second
// instance -- move to Postgres with a short TTL index if this ever runs behind a load balancer.
const pendingExchanges = new Map();
const EXCHANGE_TTL_MS = 60_000;

function isConfigured() {
  return Boolean(env.google.clientId && env.google.clientSecret && env.google.redirectUri);
}

function requireConfigured() {
  if (!isConfigured()) {
    throw new ApiError(503, 'sso_not_configured', 'Google SSO is not configured on this server');
  }
}

function client() {
  return new OAuth2Client(env.google.clientId, env.google.clientSecret, env.google.redirectUri);
}

function getAuthUrl() {
  requireConfigured();
  const state = jwt.sign({ purpose: 'sso_state', nonce: crypto.randomBytes(16).toString('hex') }, env.jwtSecret, {
    expiresIn: STATE_TTL,
  });
  const options = { access_type: 'online', scope: SCOPES, state, prompt: 'select_account' };
  if (env.google.workspaceDomain) options.hd = env.google.workspaceDomain;
  return client().generateAuthUrl(options);
}

function verifyState(state) {
  try {
    const payload = jwt.verify(state, env.jwtSecret);
    if (payload.purpose !== 'sso_state') throw new Error('wrong purpose');
  } catch {
    throw new ApiError(401, 'invalid_state', 'SSO state is invalid or expired');
  }
}

function storeExchange(userId) {
  const code = crypto.randomBytes(32).toString('hex');
  pendingExchanges.set(code, { userId, expiresAt: Date.now() + EXCHANGE_TTL_MS });
  return code;
}

// Identity verification only -- no session is issued here. Google, not this endpoint, is the
// source of truth: exchanges the authorization code for tokens, verifies the ID token's
// signature/audience, and only then trusts the email inside it. The actual session is issued
// exactly once, in exchangeCode() below, so a slow/retried callback can never double-issue one.
async function handleCallback({ code, state }) {
  requireConfigured();
  verifyState(state);

  const oauthClient = client();
  let tokens;
  try {
    ({ tokens } = await oauthClient.getToken(code));
  } catch (err) {
    throw new ApiError(401, 'sso_exchange_failed', `Could not exchange authorization code: ${err.message}`);
  }

  const ticket = await oauthClient.verifyIdToken({ idToken: tokens.id_token, audience: env.google.clientId });
  const payload = ticket.getPayload();

  if (!payload.email_verified) {
    throw new ApiError(403, 'email_not_verified', 'Google reports this email as unverified');
  }
  if (env.google.workspaceDomain && payload.hd !== env.google.workspaceDomain) {
    throw new ApiError(403, 'wrong_workspace_domain', 'This Google account is not part of the expected Workspace domain');
  }

  const user = await portalUserRepository.findByEmail(payload.email);
  if (!user) throw new ApiError(403, 'no_matching_account', 'No portal account is registered for this email');
  if (user.status !== 'active') throw new ApiError(423, 'account_disabled', 'Account is not active');

  return storeExchange(user.id);
}

async function exchangeCode(code, { ipAddress, userAgent }) {
  const entry = pendingExchanges.get(code);
  pendingExchanges.delete(code); // single-use regardless of outcome
  if (!entry || entry.expiresAt < Date.now()) {
    throw new ApiError(401, 'invalid_exchange_code', 'SSO exchange code is invalid or expired');
  }
  const user = await portalUserRepository.findById(entry.userId);
  if (!user || user.status !== 'active') {
    throw new ApiError(423, 'account_disabled', 'Account is not active');
  }
  return authService.loginWithSso(user.email, { ipAddress, userAgent });
}

module.exports = { isConfigured, getAuthUrl, handleCallback, exchangeCode };

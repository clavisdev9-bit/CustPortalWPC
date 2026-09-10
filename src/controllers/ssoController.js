const asyncHandler = require('../utils/asyncHandler');
const ssoService = require('../services/ssoService');
const auditService = require('../services/auditService');
const env = require('../config/env');

// Reached by a full browser navigation (the "Sign in with Google" link), never a fetch call --
// a config error must redirect back to a real page, not surface a naked JSON error response.
const googleStart = asyncHandler(async (req, res) => {
  try {
    res.redirect(ssoService.getAuthUrl());
  } catch (err) {
    res.redirect(`${env.appBaseUrl}/login?sso_error=${encodeURIComponent(err.code || 'sso_failed')}`);
  }
});

// Always redirects back to the frontend (success or failure) -- this endpoint is reached by a
// full browser navigation from Google, not a fetch call, so it can never just return JSON.
const googleCallback = asyncHandler(async (req, res) => {
  const loginUrl = `${env.appBaseUrl}/login`;
  if (req.query.error) {
    return res.redirect(`${loginUrl}?sso_error=${encodeURIComponent(req.query.error)}`);
  }
  try {
    const exchangeCode = await ssoService.handleCallback({ code: req.query.code, state: req.query.state });
    res.redirect(`${env.appBaseUrl}/sso/callback?code=${exchangeCode}`);
  } catch (err) {
    res.redirect(`${loginUrl}?sso_error=${encodeURIComponent(err.code || 'sso_failed')}`);
  }
});

const exchange = asyncHandler(async (req, res) => {
  const result = await ssoService.exchangeCode(req.body.code, {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });
  await auditService.record(req, {
    action: 'auth.sso_login',
    targetType: 'portal_user',
    targetId: result.user ? result.user.id : null,
  });
  res.json(result);
});

module.exports = { googleStart, googleCallback, exchange };

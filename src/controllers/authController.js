const asyncHandler = require('../utils/asyncHandler');
const authService = require('../services/authService');
const auditService = require('../services/auditService');
const emailService = require('../services/emailService');
const {
  loginSchema,
  refreshSchema,
  verifyTwoFactorSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  requestOtpSchema,
  verifyOtpSchema,
} = require('../validators/authValidators');

const login = asyncHandler(async (req, res) => {
  const body = loginSchema.parse(req.body);
  const result = await authService.login({ ...body, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  await auditService.record(req, {
    action: 'auth.login',
    targetType: 'portal_user',
    targetId: result.user ? result.user.id : null,
  });
  res.json(result);
});

const logout = asyncHandler(async (req, res) => {
  await authService.logout({ sessionId: req.user.sessionId });
  await auditService.record(req, { action: 'auth.logout' });
  res.status(204).end();
});

const refresh = asyncHandler(async (req, res) => {
  const body = refreshSchema.parse(req.body);
  res.json(await authService.refresh({ refreshToken: body.refresh_token }));
});

const enableTwoFactor = asyncHandler(async (req, res) => {
  res.json(await authService.enableTwoFactor({ userId: req.user.id }));
});

const verifyTwoFactor = asyncHandler(async (req, res) => {
  const body = verifyTwoFactorSchema.parse(req.body);
  const result = await authService.verifyTwoFactor({
    userId: req.user ? req.user.id : null,
    challengeToken: body.challenge_token,
    code: body.code,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });
  await auditService.record(req, { action: 'auth.2fa_verified' });
  res.json(result);
});

const changePassword = asyncHandler(async (req, res) => {
  const body = changePasswordSchema.parse(req.body);
  await authService.changePassword({
    userId: req.user.id,
    currentPassword: body.current_password,
    newPassword: body.new_password,
  });
  await auditService.record(req, { action: 'auth.password_change' });
  res.status(204).end();
});

// authService.forgotPassword emails the reset link for real once SMTP is configured. The debug
// token is only echoed back when email delivery is the console fallback (no SMTP set) in a
// non-production environment -- same JSON-body pattern userService.create already uses for
// activation_token, so the frontend (which only ever reads response bodies, never headers -- see
// BUG-06) can actually surface it. Once real SMTP is wired up, this field never appears.
const forgotPassword = asyncHandler(async (req, res) => {
  const body = forgotPasswordSchema.parse(req.body);
  const token = await authService.forgotPassword(body);
  const payload = {};
  if (token && emailService.isConsoleFallback() && process.env.NODE_ENV !== 'production') {
    payload.debug_reset_token = token;
  }
  res.status(202).json(payload);
});

const resetPassword = asyncHandler(async (req, res) => {
  const body = resetPasswordSchema.parse(req.body);
  await authService.resetPassword({ resetToken: body.reset_token, newPassword: body.new_password });
  res.status(204).end();
});

// Same enumeration-safe shape as forgotPassword above: always 202 regardless of whether the email
// is registered, eligible, or currently rate-limited (Docs/CR/customer_portal_passwordless_otp_login.md
// section 6 -- rate-limit rejections are silently absorbed rather than surfaced distinctly). The
// debug_otp field only ever appears under the same non-production/no-SMTP condition as
// debug_reset_token above.
const requestOtp = asyncHandler(async (req, res) => {
  const body = requestOtpSchema.parse(req.body);
  const code = await authService.requestOtpLogin({
    ...body,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });
  const payload = {};
  if (code && emailService.isConsoleFallback() && process.env.NODE_ENV !== 'production') {
    payload.debug_otp = code;
  }
  res.status(202).json(payload);
});

// /auth/otp/resend is a distinct UI affordance for the same operation as /auth/otp/request (see
// the CR's section 11.3) -- sharing requestOtpLogin() means the cooldown/rate-limit and
// supersede-previous-code behavior apply identically no matter which button the customer used.
const resendOtp = requestOtp;

const verifyOtp = asyncHandler(async (req, res) => {
  const body = verifyOtpSchema.parse(req.body);
  const result = await authService.verifyOtpLogin({
    ...body,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });
  await auditService.record(req, {
    action: 'auth.otp_verified',
    targetType: 'portal_user',
    targetId: result.user ? result.user.id : null,
  });
  res.json(result);
});

module.exports = {
  login,
  logout,
  refresh,
  enableTwoFactor,
  verifyTwoFactor,
  changePassword,
  forgotPassword,
  resetPassword,
  requestOtp,
  resendOtp,
  verifyOtp,
};

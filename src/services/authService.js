const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authenticator } = require('otplib');
const env = require('../config/env');
const crypto = require('../utils/crypto');
const ApiError = require('../utils/ApiError');
const portalUserRepository = require('../repositories/portalUserRepository');
const sessionRepository = require('../repositories/sessionRepository');
const refreshTokenRepository = require('../repositories/refreshTokenRepository');
const odooCompanyRepository = require('../repositories/odooCompanyRepository');
const companyService = require('./companyService');
const otpTokenRepository = require('../repositories/otpTokenRepository');
const emailService = require('./emailService');

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const REFRESH_TOKEN_BYTES = 48;

function signAccessToken(userId, sessionId) {
  return jwt.sign({ sub: userId, sid: sessionId, purpose: 'access' }, env.jwtSecret, {
    expiresIn: env.accessTokenTtl,
  });
}

async function toPublicUser(user) {
  const roles = await portalUserRepository.getRoleNames(user.id);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    status: user.status,
    two_factor_enabled: user.two_factor_enabled,
    is_platform_admin: user.is_platform_admin,
    roles,
    last_login_at: user.last_login_at,
    created_at: user.created_at,
  };
}

async function issueSession(user, { ipAddress, userAgent }) {
  const companies = await odooCompanyRepository.listForUser(user.id);

  // BUG-37. `is_default` menang, selalu -- dan itu koreksi atas BUG-36, yang sempat mendahulukan
  // "koneksi yang hidup" di atasnya.
  //
  // `is_default` bukan preferensi tampilan. Sejak CR-040 ia diisi dari `company_id` milik kontak
  // itu sendiri di Odoo, jadi ia adalah jawaban ODOO atas "pelanggan ini duduk di mana". Company
  // lain milik user hampir selalu berada di KONEKSI lain, dan koneksi lain berarti database Odoo
  // lain -- tempat id partner yang sama menunjuk orang yang sama sekali berbeda (BUG-32). Pada
  // kasus yang melahirkan BUG-37, memindahkan satu langkah berarti memindahkan pelanggan dari
  // partner 8 di `pt_dira_staging` ke partner 125 di database `prod`: bukan company cadangan,
  // melainkan identitas pelanggan yang lain.
  //
  // Portal tidak pernah berhak memutuskan pelanggan ini sebenarnya siapa (CLAUDE.md: Odoo adalah
  // system of record). Koneksi yang sedang dimatikan admin menghasilkan 503 "hubungi
  // administrator portal" -- jawaban yang benar, dan yang bisa ditindaklanjuti admin -- sementara
  // relokasi diam-diam menghasilkan halaman yang tampak bekerja sambil menampilkan data yang salah.
  //
  // Tanpa `is_default` sama sekali, pilihannya memang arbitrer (dulu `companies[0]`). Di situ, dan
  // hanya di situ, kesehatan koneksi menjadi tiebreak yang masuk akal -- dan `is_enabled` saja
  // tidak cukup: koneksi bisa menyala tapi `status = 'error'`, persis `Main Odoo` yang url-nya
  // tidak pernah ada dan justru itulah yang dipilih BUG-36.
  //
  // Aturannya sendiri hidup di `companyService`, dipakai bersama skrip pemeriksanya -- lihat
  // komentar di sana untuk alasan kenapa ia tidak boleh disalin.
  const defaultCompany = companyService.pickDefaultCompany(companies);

  const session = await sessionRepository.create({
    userId: user.id,
    currentCompanyId: defaultCompany ? defaultCompany.id : null,
    ipAddress,
    userAgent,
    expiresAt: new Date(Date.now() + env.refreshTokenTtlDays * 24 * 60 * 60 * 1000),
  });

  const refreshToken = crypto.randomToken(REFRESH_TOKEN_BYTES);
  await refreshTokenRepository.create({
    sessionId: session.id,
    tokenHash: crypto.sha256(refreshToken),
    expiresAt: session.expires_at,
  });

  return {
    access_token: signAccessToken(user.id, session.id),
    refresh_token: refreshToken,
    user: await toPublicUser(user),
  };
}

async function login({ email, password, ipAddress, userAgent }) {
  const user = await portalUserRepository.findByEmail(email);
  if (!user) throw new ApiError(401, 'invalid_credentials', 'Invalid email or password');

  if (user.status !== 'active') throw new ApiError(423, 'account_disabled', 'Account is not active');
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new ApiError(423, 'account_locked', 'Account is temporarily locked');
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    const attempts = user.failed_login_attempts + 1;
    const lock = attempts >= MAX_FAILED_ATTEMPTS;
    await portalUserRepository.recordFailedLogin(user.id, {
      lock,
      lockUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000) : null,
    });
    throw new ApiError(401, 'invalid_credentials', 'Invalid email or password');
  }

  await portalUserRepository.resetLoginState(user.id);

  if (user.two_factor_enabled) {
    const challengeToken = jwt.sign({ sub: user.id, purpose: '2fa_challenge' }, env.jwtSecret, { expiresIn: '5m' });
    return { requires_2fa: true, challenge_token: challengeToken };
  }

  return issueSession(user, { ipAddress, userAgent });
}

// SSO delegates strong authentication to the identity provider entirely -- Google already
// proved the user controls that verified email, so this skips both password and 2FA (the same
// way most enterprise SSO integrations treat the IdP's own login as satisfying MFA). It matches
// an EXISTING portal_user by email rather than creating one: SSO federates identity for an
// already-provisioned account, it is not a self-service signup path.
async function loginWithSso(email, { ipAddress, userAgent }) {
  const user = await portalUserRepository.findByEmail(email);
  if (!user) throw new ApiError(403, 'no_matching_account', 'No portal account is registered for this email');
  if (user.status !== 'active') throw new ApiError(423, 'account_disabled', 'Account is not active');
  await portalUserRepository.resetLoginState(user.id);
  return issueSession(user, { ipAddress, userAgent });
}

// Passwordless email-OTP login (Docs/CR/customer_portal_passwordless_otp_login.md), additive
// alongside login()/loginWithSso() above -- both paths end at the same issueSession(). Always
// resolves without throwing, even for an unregistered email or a non-active account: the
// controller responds 202 either way (same enumeration-safe shape as forgotPassword()), and this
// returns the plaintext code only when one was actually generated, so the controller can echo it
// back as a debug field in non-production environments without real SMTP configured.
async function requestOtpLogin({ email, ipAddress, userAgent }) {
  const user = await portalUserRepository.findByEmail(email);
  if (!user || user.status !== 'active') return null;

  const windowStart = new Date(Date.now() - env.otp.requestWindowMinutes * 60 * 1000);
  const recentRequests = await otpTokenRepository.countRecentRequests(user.id, windowStart);
  if (recentRequests >= env.otp.maxRequestsPerWindow) return null;

  const lastToken = await otpTokenRepository.findMostRecent(user.id);
  if (lastToken) {
    const elapsedMs = Date.now() - new Date(lastToken.created_at).getTime();
    if (elapsedMs < env.otp.resendCooldownSeconds * 1000) return null;
  }

  const code = crypto.randomNumericCode(env.otp.length);
  // Supersede-then-insert, same two-step (not transaction-wrapped) pattern refresh() already uses
  // for rotate-then-create -- only one OTP is ever `pending` for a user at a time.
  await otpTokenRepository.supersedePending(user.id);
  await otpTokenRepository.create({
    portalUserId: user.id,
    tokenHash: crypto.sha256(code),
    expiresAt: new Date(Date.now() + env.otp.ttlMinutes * 60 * 1000),
    ipAddress,
    userAgent,
  });

  await emailService.send({
    to: user.email,
    subject: 'Your Customer Portal login code',
    text: `Your login code is ${code}. It expires in ${env.otp.ttlMinutes} minutes.\nIf you didn't request this, you can ignore this email.`,
    html: `<p>Your login code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:4px;">${code}</p><p>This code expires in ${env.otp.ttlMinutes} minutes. If you didn't request this, you can ignore this email.</p>`,
  });

  return code;
}

async function verifyOtpLogin({ email, otp, ipAddress, userAgent }) {
  const invalidError = () => new ApiError(401, 'invalid_otp', 'Invalid or expired code');

  const user = await portalUserRepository.findByEmail(email);
  if (!user) throw invalidError();

  const pending = await otpTokenRepository.findLatestPending(user.id);
  if (!pending) throw invalidError();

  if (new Date(pending.expires_at) <= new Date()) {
    throw new ApiError(401, 'otp_expired', 'This code has expired. Request a new one.');
  }
  if (pending.attempt_count >= env.otp.maxAttempts) {
    await otpTokenRepository.markLocked(pending.id);
    throw new ApiError(429, 'too_many_attempts', 'Too many incorrect attempts. Request a new code.');
  }

  if (crypto.sha256(otp) !== pending.token_hash) {
    const updated = await otpTokenRepository.incrementAttempt(pending.id);
    if (updated.attempt_count >= env.otp.maxAttempts) {
      await otpTokenRepository.markLocked(pending.id);
      throw new ApiError(429, 'too_many_attempts', 'Too many incorrect attempts. Request a new code.');
    }
    throw invalidError();
  }

  // Re-checked here, not just at requestOtpLogin() time -- closes the same race CR-007 closed for
  // resetPassword/verifyTwoFactor: an admin could disable the account in the window between OTP
  // request and verification. Same generic error as any other rejection, so this doesn't leak
  // account status through a distinct error message.
  if (user.status !== 'active') throw invalidError();

  await otpTokenRepository.markVerified(pending.id);
  await portalUserRepository.resetLoginState(user.id);
  return issueSession(user, { ipAddress, userAgent });
}

async function refresh({ refreshToken }) {
  const tokenHash = crypto.sha256(refreshToken);
  const stored = await refreshTokenRepository.findActiveByHash(tokenHash);
  if (!stored) throw new ApiError(401, 'invalid_refresh_token', 'Refresh token is invalid or expired');

  const session = await sessionRepository.findActiveById(stored.session_id);
  if (!session) throw new ApiError(401, 'invalid_refresh_token', 'Session is no longer active');

  const user = await portalUserRepository.findById(session.user_id);
  const newRefreshToken = crypto.randomToken(REFRESH_TOKEN_BYTES);
  const newRow = await refreshTokenRepository.create({
    sessionId: session.id,
    tokenHash: crypto.sha256(newRefreshToken),
    expiresAt: session.expires_at,
  });

  // BUG-33. `findActiveByHash` di atas hanya memeriksa, tidak mengunci: dua permintaan refresh
  // bersamaan dengan token yang sama sama-sama lolos sampai titik ini. Rotasi yang bersyarat
  // (`WHERE status = 'active'`) adalah tempat perlombaan itu benar-benar diputuskan -- hanya satu
  // pemanggil yang bisa memenangkannya.
  //
  // Yang kalah harus membatalkan baris yang barusan dibuatnya. Membiarkannya `active` justru
  // menghasilkan keadaan yang bug ini ada untuk menghapus: satu sesi dengan dua refresh token
  // aktif, yang berarti token curian bisa diputar ulang selama pemiliknya masih memakai sesinya.
  const won = await refreshTokenRepository.rotate(stored.id, newRow.id);
  if (!won) {
    await refreshTokenRepository.revokeById(newRow.id);
    throw new ApiError(401, 'invalid_refresh_token', 'Refresh token was already used');
  }

  return {
    access_token: signAccessToken(user.id, session.id),
    refresh_token: newRefreshToken,
    user: await toPublicUser(user),
  };
}

async function logout({ sessionId }) {
  await sessionRepository.revoke(sessionId);
  await refreshTokenRepository.revokeBySession(sessionId);
}

async function enableTwoFactor({ userId }) {
  const secret = authenticator.generateSecret();
  const user = await portalUserRepository.findById(userId);
  await portalUserRepository.update(userId, { two_factor_secret: crypto.encrypt(secret) });
  const otpauthUrl = authenticator.keyuri(user.email, 'CustPortalWPC', secret);
  return { secret, otpauth_url: otpauthUrl };
}

async function verifyTwoFactor({ userId, challengeToken, code, ipAddress, userAgent }) {
  if (userId) {
    const user = await portalUserRepository.findById(userId);
    if (!user.two_factor_secret) throw new ApiError(422, 'no_pending_2fa', 'No 2FA enrollment in progress');
    const secret = crypto.decrypt(user.two_factor_secret);
    if (!authenticator.verify({ token: code, secret })) {
      throw new ApiError(401, 'invalid_code', 'Invalid 2FA code');
    }
    const updated = await portalUserRepository.update(userId, { two_factor_enabled: true });
    return issueSession(updated, { ipAddress, userAgent });
  }

  if (!challengeToken) throw new ApiError(400, 'missing_challenge', 'challenge_token is required');
  let payload;
  try {
    payload = jwt.verify(challengeToken, env.jwtSecret);
  } catch {
    throw new ApiError(401, 'invalid_challenge', 'Challenge token is invalid or expired');
  }
  if (payload.purpose !== '2fa_challenge') throw new ApiError(401, 'invalid_challenge', 'Wrong token purpose');

  const user = await portalUserRepository.findById(payload.sub);
  // login() only checked status when this challenge_token was minted, up to 5 minutes ago -- an
  // admin could have disabled the account in the meantime, so it's re-checked here too, right
  // before a session is actually issued (see BUG-07). Same generic error as an expired/invalid
  // challenge token, so this doesn't leak account status through a distinct error message.
  if (!user || user.status !== 'active') {
    throw new ApiError(401, 'invalid_challenge', 'Challenge token is invalid or expired');
  }
  const secret = crypto.decrypt(user.two_factor_secret);
  if (!authenticator.verify({ token: code, secret })) {
    throw new ApiError(401, 'invalid_code', 'Invalid 2FA code');
  }
  return issueSession(user, { ipAddress, userAgent });
}

async function changePassword({ userId, currentPassword, newPassword }) {
  const user = await portalUserRepository.findById(userId);
  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) throw new ApiError(401, 'invalid_password', 'Current password is incorrect');
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await portalUserRepository.update(userId, { password_hash: passwordHash });
}

function generateResetToken(userId) {
  return jwt.sign({ sub: userId, purpose: 'password_reset' }, env.jwtSecret, { expiresIn: '30m' });
}

// Always resolves, even for an unknown email or a disabled account -- the controller responds 202
// either way so the API never reveals whether an address is registered or its account status.
// pending_verification is deliberately still allowed through (e.g. a lost/expired activation
// email is a legitimate reason to request a fresh link), but disabled must not be: an admin
// disabling a compromised/offboarded account has to actually revoke access, not just require the
// account to jump through this flow to undo it (see BUG-07).
async function forgotPassword({ email }) {
  const user = await portalUserRepository.findByEmail(email);
  if (!user || user.status === 'disabled') return null;
  const token = generateResetToken(user.id);
  const link = `${env.appBaseUrl}/reset-password?token=${token}`;
  await emailService.send({
    to: user.email,
    subject: 'Reset your Customer Portal password',
    text: `Reset your password: ${link}\nThis link expires in 30 minutes.`,
    html: `<p>Click below to reset your password. This link expires in 30 minutes.</p><p><a href="${link}">${link}</a></p>`,
  });
  return token;
}

async function resetPassword({ resetToken, newPassword }) {
  let payload;
  try {
    payload = jwt.verify(resetToken, env.jwtSecret);
  } catch {
    throw new ApiError(401, 'invalid_reset_token', 'Reset token is invalid or expired');
  }
  if (payload.purpose !== 'password_reset') throw new ApiError(401, 'invalid_reset_token', 'Wrong token purpose');

  // Re-checks status here too, not just at forgotPassword() time -- closes the race where an
  // admin disables the account in the (up to 30-minute) window after a reset token was issued
  // while it was still active. Same generic error as an expired/invalid token, so this doesn't
  // leak account status through a distinct error message.
  const user = await portalUserRepository.findById(payload.sub);
  if (!user || user.status === 'disabled') {
    throw new ApiError(401, 'invalid_reset_token', 'Reset token is invalid or expired');
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await portalUserRepository.update(payload.sub, { password_hash: passwordHash, status: 'active' });
}

module.exports = {
  login,
  loginWithSso,
  requestOtpLogin,
  verifyOtpLogin,
  refresh,
  logout,
  enableTwoFactor,
  verifyTwoFactor,
  changePassword,
  forgotPassword,
  resetPassword,
  generateResetToken,
  toPublicUser,
};

const jwt = require('jsonwebtoken');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const sessionRepository = require('../repositories/sessionRepository');

// Section 22: a bearer access token alone is not enough -- the session behind it must still be
// active, so /auth/logout and refresh-token rotation can actually revoke access immediately.
async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new ApiError(401, 'unauthenticated', 'Missing bearer token');
    }
    const payload = jwt.verify(token, env.jwtSecret);
    if (payload.purpose !== 'access') {
      throw new ApiError(401, 'unauthenticated', 'Token is not an access token');
    }
    const session = await sessionRepository.findActiveById(payload.sid);
    if (!session || session.user_id !== payload.sub) {
      throw new ApiError(401, 'unauthenticated', 'Session is no longer valid');
    }
    req.user = { id: payload.sub, sessionId: session.id, currentCompanyId: session.current_company_id };
    next();
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    next(new ApiError(401, 'unauthenticated', 'Invalid or expired token'));
  }
}

// Used only by /auth/2fa/verify, which serves both an authenticated enrollment-confirmation call
// and an unauthenticated login-challenge call (section 8, 11).
function optionalAuthenticate(req, res, next) {
  if (!req.headers.authorization) return next();
  authenticate(req, res, (err) => {
    if (err) req.user = null;
    next();
  });
}

module.exports = { authenticate, optionalAuthenticate };

const { Router } = require('express');
const authController = require('../controllers/authController');
const ssoController = require('../controllers/ssoController');
const { authenticate, optionalAuthenticate } = require('../middleware/authenticate');

const router = Router();

router.post('/login', authController.login);
router.post('/logout', authenticate, authController.logout);
router.post('/refresh', authController.refresh);
router.post('/2fa/enable', authenticate, authController.enableTwoFactor);
router.post('/2fa/verify', optionalAuthenticate, authController.verifyTwoFactor);
router.post('/password/change', authenticate, authController.changePassword);
router.post('/password/forgot', authController.forgotPassword);
router.post('/password/reset', authController.resetPassword);

// Passwordless email-OTP login (Docs/CR/customer_portal_passwordless_otp_login.md) -- additive
// alongside /login above, ends at the same session-issuance code path.
router.post('/otp/request', authController.requestOtp);
router.post('/otp/verify', authController.verifyOtp);
router.post('/otp/resend', authController.resendOtp);

// Phase 7 SSO (Google Workspace). /start and /callback are full browser navigations (redirects
// to/from Google), never fetch calls -- /exchange is the one JSON endpoint, called by the
// frontend's /sso/callback page with the one-time code the redirect handed it.
router.get('/sso/google/start', ssoController.googleStart);
router.get('/sso/google/callback', ssoController.googleCallback);
router.post('/sso/exchange', ssoController.exchange);

module.exports = router;

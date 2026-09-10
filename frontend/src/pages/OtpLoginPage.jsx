import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { requestOtpLogin, resendOtpLogin, verifyOtpLogin } from '../api/client';

const RESEND_COOLDOWN_SECONDS = 30;

// Only invalid_otp/otp_expired/too_many_attempts ever reach the customer with a distinct message
// (Docs/CR/customer_portal_passwordless_otp_login.md section 8) -- an unregistered email or a
// disabled account is indistinguishable from "check your email" at every step, by design.
const OTP_ERROR_MESSAGES = {
  invalid_otp: "That code isn't right.",
  otp_expired: 'This code has expired. Send a new one.',
  too_many_attempts: 'Too many incorrect attempts. Request a new code.',
};

export default function OtpLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [debugOtp, setDebugOtp] = useState(null);
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => () => clearInterval(timerRef.current), []);

  function startCooldown() {
    setCooldown(RESEND_COOLDOWN_SECONDS);
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCooldown((seconds) => {
        if (seconds <= 1) {
          clearInterval(timerRef.current);
          return 0;
        }
        return seconds - 1;
      });
    }, 1000);
  }

  async function sendCode(requestFn) {
    setError(null);
    setSubmitting(true);
    try {
      const result = await requestFn({ email });
      // Only ever present when SMTP isn't configured (console-fallback) in a non-production
      // environment -- see authController.requestOtp. Mirrors ForgotPasswordPage's debug_reset_token.
      setDebugOtp(result?.debug_otp || null);
      setStep('code');
      startCooldown();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEmailSubmit(e) {
    e.preventDefault();
    await sendCode(requestOtpLogin);
  }

  async function handleResend() {
    if (cooldown > 0) return;
    await sendCode(resendOtpLogin);
  }

  async function handleCodeSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await verifyOtpLogin({ email, otp });
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      setError(OTP_ERROR_MESSAGES[err.code] || err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function useDifferentEmail() {
    clearInterval(timerRef.current);
    setStep('email');
    setOtp('');
    setError(null);
    setDebugOtp(null);
    setCooldown(0);
  }

  return (
    <div className="auth-page">
      <form onSubmit={step === 'email' ? handleEmailSubmit : handleCodeSubmit} className="auth-card">
        <h1>Log in with a code</h1>
        {error && <p className="error">{error}</p>}

        {step === 'email' ? (
          <>
            <label>
              Email
              <input required autoFocus type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <button type="submit" disabled={submitting}>
              {submitting ? 'Sending...' : 'Send code'}
            </button>
          </>
        ) : (
          <>
            <p className="success">If {email} is registered, we&apos;ve sent a login code. It expires in a few minutes.</p>
            {debugOtp && (
              <p className="activation-token">
                SMTP is not configured in this environment -- your code (dev only): <strong>{debugOtp}</strong>
              </p>
            )}
            <label>
              Login code
              <input
                required
                autoFocus
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={10}
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
              />
            </label>
            <div className="button-row">
              <button type="submit" disabled={submitting}>
                {submitting ? 'Verifying...' : 'Verify'}
              </button>
              <button type="button" disabled={submitting || cooldown > 0} onClick={handleResend}>
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
              </button>
            </div>
            <button type="button" onClick={useDifferentEmail}>
              Use a different email
            </button>
          </>
        )}

        <Link to="/login">Use password instead</Link>
      </form>
    </div>
  );
}

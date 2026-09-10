import { useState } from 'react';
import { Link } from 'react-router-dom';
import { forgotPassword } from '../api/client';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [debugToken, setDebugToken] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await forgotPassword({ email });
      setSubmitted(true);
      // Only ever present when SMTP isn't configured (console-fallback) in a non-production
      // environment -- see authController.forgotPassword. Without this, there is no way to
      // complete the reset flow at all in an environment with no real mailbox to check.
      setDebugToken(result?.debug_reset_token || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <form onSubmit={handleSubmit} className="auth-card">
        <h1>Forgot password</h1>
        {error && <p className="error">{error}</p>}
        {submitted ? (
          <>
            <p className="success">If that email is registered, a reset link has been sent.</p>
            {debugToken && (
              <p className="activation-token">
                SMTP is not configured in this environment -- reset link (dev only):
                <br />
                <Link to={`/reset-password?token=${debugToken}`}>Continue to reset password</Link>
              </p>
            )}
          </>
        ) : (
          <>
            <label>
              Email
              <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <button type="submit" disabled={submitting}>
              {submitting ? 'Sending...' : 'Send reset link'}
            </button>
          </>
        )}
        <Link to="/login">Back to sign in</Link>
      </form>
    </div>
  );
}

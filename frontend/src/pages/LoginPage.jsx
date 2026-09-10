import { useState } from 'react';
import { useNavigate, useLocation, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { GOOGLE_SSO_START_URL } from '../api/client';

const SSO_ERROR_MESSAGES = {
  no_matching_account: 'No portal account is registered for this Google account.',
  account_disabled: 'This account is not active.',
  wrong_workspace_domain: "This Google account isn't part of the expected Workspace domain.",
  email_not_verified: 'Google reports this email as unverified.',
  sso_not_configured: 'Google sign-in is not configured for this portal.',
};

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const ssoError = searchParams.get('sso_error');

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await login({ email, password });
      if (result.requires_2fa) {
        navigate('/2fa', { state: { challengeToken: result.challenge_token } });
      } else {
        navigate(location.state?.from || '/', { replace: true });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-split">
        <aside className="auth-brand">
          <div className="auth-brand__mark">
            <span className="logo" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-6 9 6v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <path d="M9 21V12h6v9" />
              </svg>
            </span>
            Customer Portal
          </div>
          <div>
            <blockquote>Every quotation, order, invoice, and warranty — in one place.</blockquote>
            <div className="auth-brand__chips">
              <span>Real-time status</span>
              <span>Self-service reorder</span>
              <span>Online payments</span>
            </div>
          </div>
          <div className="auth-brand__caption">Securely connected to your company account.</div>
        </aside>

        <form onSubmit={handleSubmit} className="auth-form">
          <div>
            <h1>Sign in</h1>
            <p className="lead">Use your company email to continue.</p>
          </div>
          {error && <p className="error">{error}</p>}
          {ssoError && <p className="error">{SSO_ERROR_MESSAGES[ssoError] || 'Google sign-in failed.'}</p>}
          <label>
            Email
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Password
            <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>
          <div className="divider">or</div>
          {/* A plain link, not an onClick+fetch -- this must be a full browser navigation to Google. */}
          <a href={GOOGLE_SSO_START_URL} className="sso-button">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.5-1.7 4.4-5.5 4.4-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.9 1.5l2.6-2.5C16.9 3.4 14.7 2.4 12 2.4 6.9 2.4 2.8 6.5 2.8 11.6S6.9 20.8 12 20.8c5.9 0 9.8-4.1 9.8-9.9 0-.7-.1-1.2-.2-1.7z" />
            </svg>
            Sign in with Google
          </a>
          <div className="auth-form__links">
            <Link to="/otp-login">Log in with a code instead</Link>
            <Link to="/forgot-password">Forgot password?</Link>
          </div>
        </form>
      </div>
    </div>
  );
}

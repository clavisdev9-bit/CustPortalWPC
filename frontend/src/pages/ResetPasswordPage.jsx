import { useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { resetPassword } from '../api/client';

// Also the landing page for a new user's activation link -- backend's /auth/password/reset
// activates a pending_verification account the same way it resets an active one's password.
export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await resetPassword({ resetToken: token, newPassword });
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>Invalid link</h1>
          <p className="error">No reset token found in the URL.</p>
          <Link to="/forgot-password">Request a new link</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <form onSubmit={handleSubmit} className="auth-card">
        <h1>Set a new password</h1>
        {error && <p className="error">{error}</p>}
        {done ? (
          <>
            <p className="success">Password updated.</p>
            <button type="button" onClick={() => navigate('/login')}>
              Go to sign in
            </button>
          </>
        ) : (
          <>
            <label>
              New password
              <input
                required
                type="password"
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </label>
            <button type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : 'Set password'}
            </button>
          </>
        )}
      </form>
    </div>
  );
}

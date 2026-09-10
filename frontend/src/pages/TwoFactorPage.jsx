import { useState } from 'react';
import { useLocation, useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function TwoFactorPage() {
  const { verifyTwoFactor } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const challengeToken = location.state?.challengeToken;
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  if (!challengeToken) return <Navigate to="/login" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await verifyTwoFactor({ challengeToken, code });
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <form onSubmit={handleSubmit} className="auth-card">
        <h1>Two-factor verification</h1>
        {error && <p className="error">{error}</p>}
        <label>
          6-digit code
          <input required autoFocus value={code} onChange={(e) => setCode(e.target.value)} maxLength={6} />
        </label>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Verifying...' : 'Verify'}
        </button>
      </form>
    </div>
  );
}

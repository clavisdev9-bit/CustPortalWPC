import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Navigate } from 'react-router-dom';
import { exchangeSsoCode } from '../api/client';

// Landing point for Google's redirect (via the backend's /auth/sso/google/callback), which
// hands this page a one-time code in the query string -- never the session tokens themselves.
export default function SsoCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const code = searchParams.get('code');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!code) return;
    exchangeSsoCode(code)
      .then(() => navigate('/', { replace: true }))
      .catch((err) => setError(err.message));
  }, [code, navigate]);

  if (!code) return <Navigate to="/login" replace />;

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Signing you in...</h1>
        {error ? (
          <>
            <p className="error">{error}</p>
            <button type="button" onClick={() => navigate('/login', { replace: true })}>
              Back to sign in
            </button>
          </>
        ) : (
          <p className="muted">Please wait.</p>
        )}
      </div>
    </div>
  );
}

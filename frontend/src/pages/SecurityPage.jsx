import { useState } from 'react';
import { changePassword, enableTwoFactor, confirmTwoFactorEnrollment } from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function SecurityPage() {
  const { user } = useAuth();
  const [passwordForm, setPasswordForm] = useState({ current_password: '', new_password: '' });
  const [passwordMessage, setPasswordMessage] = useState(null);
  const [enrollment, setEnrollment] = useState(null);
  const [code, setCode] = useState('');
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  async function handlePasswordChange(e) {
    e.preventDefault();
    setError(null);
    setPasswordMessage(null);
    try {
      await changePassword(passwordForm);
      setPasswordMessage('Password updated.');
      setPasswordForm({ current_password: '', new_password: '' });
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleEnable2FA() {
    setError(null);
    try {
      setEnrollment(await enableTwoFactor());
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleConfirm2FA(e) {
    e.preventDefault();
    setError(null);
    try {
      await confirmTwoFactorEnrollment(code);
      setMessage('2FA enabled.');
      setEnrollment(null);
      setCode('');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="security-page">
      <h1>Security</h1>
      {error && <p className="error">{error}</p>}

      <section className="card">
        <h2>Change password</h2>
        <form onSubmit={handlePasswordChange} className="form-grid">
          <label>
            Current password
            <input
              required
              type="password"
              value={passwordForm.current_password}
              onChange={(e) => setPasswordForm({ ...passwordForm, current_password: e.target.value })}
            />
          </label>
          <label>
            New password
            <input
              required
              type="password"
              minLength={8}
              value={passwordForm.new_password}
              onChange={(e) => setPasswordForm({ ...passwordForm, new_password: e.target.value })}
            />
          </label>
          <button type="submit">Update password</button>
        </form>
        {passwordMessage && <p className="success">{passwordMessage}</p>}
      </section>

      <section className="card">
        <h2>Two-factor authentication</h2>
        <p>Status: {user?.two_factor_enabled ? 'Enabled' : 'Disabled'}</p>
        {message && <p className="success">{message}</p>}
        {!user?.two_factor_enabled && !enrollment && <button onClick={handleEnable2FA}>Enable 2FA</button>}
        {enrollment && (
          <form onSubmit={handleConfirm2FA} className="form-grid">
            <p>Scan this secret in your authenticator app:</p>
            <code>{enrollment.secret}</code>
            <label>
              6-digit code
              <input required value={code} onChange={(e) => setCode(e.target.value)} maxLength={6} />
            </label>
            <button type="submit">Confirm</button>
          </form>
        )}
      </section>
    </div>
  );
}

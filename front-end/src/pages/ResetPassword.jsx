import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../api/axios';
import bagongLogo from '../assets/bagongpilipinaslogo.png';
import embLogo from '../assets/emblogo.svg';
import './Login.css';

const ResetPassword = () => {
  const { token } = useParams();
  const navigate = useNavigate();

  const [form, setForm] = useState({ password: '', confirm: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e) =>
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (form.password !== form.confirm) {
      setError('Passwords do not match.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await api.post(`/auth/reset-password/${token}`, { password: form.password });
      navigate('/login', { state: { notice: 'Password reset successful. Please sign in.' } });
    } catch (err) {
      setError(err.response?.data?.message || 'Reset failed. The link may have expired.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrapper">
      <div className="login-bg" aria-hidden="true" />

      <div className="login-card">
        <div className="login-brand">
          <div className="brand-logos">
            <img src={bagongLogo} alt="Bagong Pilipinas" />
            <div className="logo-divider" />
            <img src={embLogo} alt="Environmental Management Bureau" />
          </div>
          <h1 className="brand-title">Environmental Management Bureau</h1>
          <p className="brand-subtitle">Water Quality Monitoring System</p>
        </div>

        <h2 className="login-heading">Reset Password</h2>

        {error && (
          <div className="alert alert-error" role="alert">
            <span>⚠</span> {error}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label htmlFor="password">New Password</label>
            <input
              id="password"
              type="password"
              name="password"
              value={form.password}
              onChange={handleChange}
              placeholder="Min. 6 characters"
              required
              autoComplete="new-password"
            />
          </div>

          <div className="form-group">
            <label htmlFor="confirm">Confirm New Password</label>
            <input
              id="confirm"
              type="password"
              name="confirm"
              value={form.confirm}
              onChange={handleChange}
              placeholder="Re-enter password"
              required
              autoComplete="new-password"
            />
          </div>

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Resetting…' : 'Reset Password'}
          </button>
        </form>

        <p className="login-footer" style={{ marginTop: '1.25rem' }}>
          <Link to="/login">← Back to Sign In</Link>
        </p>
      </div>
    </div>
  );
};

export default ResetPassword;

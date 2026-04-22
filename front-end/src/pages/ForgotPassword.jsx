import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axios';
import bagongLogo from '../assets/bagongpilipinaslogo.png';
import embLogo from '../assets/emblogo.svg';
import './Login.css';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setStatus('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/forgot-password', { email });
      setStatus(data.message);
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong. Please try again.');
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

        <h2 className="login-heading">Forgot Password</h2>

        {!status ? (
          <>
            <p style={{ fontSize: '0.88rem', color: '#64748b', marginBottom: '1.2rem', textAlign: 'center' }}>
              Enter your registered email address and we'll send you a password reset link.
            </p>

            {error && (
              <div className="alert alert-error" role="alert">
                <span>⚠</span> {error}
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate>
              <div className="form-group">
                <label htmlFor="email">Email Address</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                />
              </div>

              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? 'Sending…' : 'Send Reset Link'}
              </button>
            </form>
          </>
        ) : (
          <div className="alert" style={{
            background: '#DDF8DA', border: '1px solid #7CB675', color: '#355232',
            borderRadius: '0.5rem', padding: '1rem', textAlign: 'center', fontSize: '0.9rem'
          }}>
            ✅ {status}
          </div>
        )}

        <p className="login-footer" style={{ marginTop: '1.25rem' }}>
          <Link to="/login">← Back to Sign In</Link>
        </p>
      </div>
    </div>
  );
};

export default ForgotPassword;

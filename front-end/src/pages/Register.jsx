import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import bagongLogo from '../assets/bagongpilipinaslogo.png';
import embLogo from '../assets/emblogo.svg';
import './Login.css'; // reuse login styles

const Register = () => {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e) =>
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const data = await register(form.name, form.email, form.password);
      if (data.token) {
        navigate('/');
        return;
      }
      setSuccess(data.message || 'Registration submitted. Please wait for administrator approval before signing in.');
      setForm({ name: '', email: '', password: '' });
    } catch (err) {
      setError(err.response?.data?.message || 'Registration failed. Please try again.');
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

        <h2 className="login-heading">Create Account</h2>

        {error && (
          <div className="alert alert-error" role="alert">
            <span>⚠</span> {error}
          </div>
        )}

        {success && (
          <div className="alert alert-success" role="status">
            <span>i</span> {success}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label htmlFor="name">Full Name</label>
            <input
              id="name"
              type="text"
              name="name"
              value={form.name}
              onChange={handleChange}
              placeholder="John Doe"
              required
              autoComplete="name"
            />
          </div>

          <div className="form-group">
            <label htmlFor="email">Email Address</label>
            <input
              id="email"
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
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

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Creating account…' : 'Create Account'}
          </button>
        </form>

        <p className="login-footer">
          Already have an account?{' '}
          <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
};

export default Register;

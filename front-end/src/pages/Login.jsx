import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Alert, Button, Form, Input } from 'antd';
import { LockOutlined, MailOutlined } from '@ant-design/icons';
import { useAuth } from '../context/AuthContext';
import { logActivity } from '../utils/appLog';
import bagongLogo from '../assets/bagongpilipinaslogo.png';
import embLogo from '../assets/emblogo.svg';
import './Login.css';

const Login = () => {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (values) => {
    setError('');
    setLoading(true);
    try {
      const user = await login(values.email, values.password);
      logActivity('Signed in', { email: values.email }, user);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrapper">
      {/* Background image with overlay */}
      <div className="login-bg" aria-hidden="true" />

      <div className="login-card">
        {/* Brand with logos */}
        <div className="login-brand">
          <div className="brand-logos">
            <img src={bagongLogo} alt="Bagong Pilipinas" />
            <div className="logo-divider" />
            <img src={embLogo} alt="Environmental Management Bureau" />
          </div>
          <h1 className="brand-title">Environmental Management Bureau</h1>
          <p className="brand-subtitle">Water Quality Monitoring System</p>
        </div>

        <h2 className="login-heading">Sign In</h2>

        {error && (
          <Alert
            type="error"
            showIcon
            title={error}
            style={{ marginBottom: 16 }}
          />
        )}

        <Form
          layout="vertical"
          requiredMark={false}
          onFinish={handleSubmit}
          autoComplete="on"
        >
          <Form.Item
            label="Email Address"
            name="email"
            rules={[
              { required: true, message: 'Please enter your email.' },
              { type: 'email', message: 'Enter a valid email address.' },
            ]}
          >
            <Input
              size="large"
              prefix={<MailOutlined />}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </Form.Item>

          <Form.Item
            label="Password"
            name="password"
            rules={[{ required: true, message: 'Please enter your password.' }]}
          >
            <Input.Password
              size="large"
              prefix={<LockOutlined />}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </Form.Item>

          <Button
            type="primary"
            htmlType="submit"
            size="large"
            block
            loading={loading}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </Button>
        </Form>

        <p className="login-footer">
          <Link to="/forgot-password">Forgot your password?</Link>
        </p>
        <p className="login-footer">
          Don&apos;t have an account?{' '}
          <Link to="/register">Create one</Link>
        </p>
      </div>
    </div>
  );
};

export default Login;


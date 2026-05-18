import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import api from '../api/axios';
import './Settings.css';

const ROLES = ['user', 'admin'];
const STATUS_LABELS = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

const SystemInfo = ({ mode = 'all' }) => {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    api.get('/admin/system').then((r) => setInfo(r.data)).catch(() => {});
  }, []);
  if (!info) return <div className="sinfo-loading">Loading…</div>;
  const runtimeRows = [
    ['Node.js', info.nodeVersion],
    ['Platform', info.platform],
    ['Hostname', info.hostname],
    ['Environment', info.env],
    ['Memory Used', `${info.memoryMB} MB`],
    ['Uptime', `${Math.floor(info.uptime / 3600)}h ${Math.floor((info.uptime % 3600) / 60)}m`],
  ];
  const databaseRows = [
    ['DB Status', info.dbStatus],
    ['DB Name', info.dbName || 'Not connected'],
  ];
  const rows = mode === 'runtime' ? runtimeRows : mode === 'database' ? databaseRows : [...runtimeRows, ...databaseRows];
  return (
    <dl className="sinfo-grid">
      {rows.map(([k, v]) => (
        <div key={k} className="sinfo-row">
          <dt>{k}</dt>
          <dd className={k === 'DB Status' ? (v === 'connected' ? 'db-ok' : 'db-err') : ''}>
            {k === 'DB Status' && <span className={`db-dot ${v === 'connected' ? 'ok' : 'err'}`} />}
            {v}
          </dd>
        </div>
      ))}
    </dl>
  );
};

const AccountsPanel = ({ currentUser }) => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    let mounted = true;
    api.get('/admin/users')
      .then((r) => {
        if (mounted) setUsers(r.data);
      })
      .catch(() => {
        if (mounted) setMsg('Failed to load users.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, []);

  const changeRole = async (id, role) => {
    try {
      const { data } = await api.patch(`/admin/users/${id}/role`, { role });
      setUsers((prev) => prev.map((u) => (u._id === data._id ? data : u)));
      setMsg(`Role updated to "${role}".`);
    } catch (e) {
      setMsg(e.response?.data?.message || 'Error updating role.');
    }
  };

  const changeStatus = async (id, status) => {
    try {
      const { data } = await api.patch(`/admin/users/${id}/status`, { status });
      setUsers((prev) => prev.map((u) => (u._id === data._id ? data : u)));
      setMsg(`Account status updated to "${status}".`);
    } catch (e) {
      setMsg(e.response?.data?.message || 'Error updating account status.');
    }
  };

  const deleteUser = async (id, name) => {
    if (!window.confirm(`Delete user "${name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/admin/users/${id}`);
      setUsers((prev) => prev.filter((u) => u._id !== id));
      setMsg(`User "${name}" deleted.`);
    } catch (e) {
      setMsg(e.response?.data?.message || 'Error deleting user.');
    }
  };

  if (loading) return <div className="panel-loading">Loading users…</div>;

  return (
    <div className="accounts-panel">
      {msg && (
        <div className="settings-notice" onAnimationEnd={() => setMsg('')}>
          {msg}
        </div>
      )}
      <div className="users-table-wrap">
        <table className="users-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u, i) => (
              <tr key={u._id} className={u._id === currentUser._id ? 'row-self' : ''}>
                <td className="td-num">{i + 1}</td>
                <td className="td-name">
                  <span className="u-avatar">{u.name.charAt(0).toUpperCase()}</span>
                  {u.name}
                  {u._id === currentUser._id && <span className="you-badge">You</span>}
                </td>
                <td className="td-email">{u.email}</td>
                <td>
                  <select
                    className={`role-sel ${u.role}`}
                    value={u.role}
                    disabled={u._id === currentUser._id}
                    onChange={(e) => changeRole(u._id, e.target.value)}
                  >
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td>
                  <select
                    className={`status-sel ${u.status || 'approved'}`}
                    value={u.status || 'approved'}
                    disabled={u._id === currentUser._id}
                    onChange={(e) => changeStatus(u._id, e.target.value)}
                  >
                    {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </td>
                <td className="td-date">
                  {new Date(u.createdAt).toLocaleDateString('en-PH', {
                    year: 'numeric', month: 'short', day: 'numeric',
                  })}
                </td>
                <td>
                  {u._id !== currentUser._id ? (
                    <button
                      className="del-btn"
                      onClick={() => deleteUser(u._id, u.name)}
                    >
                      🗑 Delete
                    </button>
                  ) : (
                    <span className="td-na">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const ApprovalsPanel = () => {
  const [pendingUsers, setPendingUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    let mounted = true;
    api.get('/admin/users?status=pending')
      .then(({ data }) => {
        if (mounted) setPendingUsers(data);
      })
      .catch((error) => {
        if (mounted) setMsg(error.response?.data?.message || 'Failed to load pending accounts.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, []);

  const decide = async (id, status) => {
    try {
      await api.patch(`/admin/users/${id}/status`, { status });
      setPendingUsers((prev) => prev.filter((user) => user._id !== id));
      setMsg(status === 'approved' ? 'Account approved.' : 'Account rejected.');
    } catch (error) {
      setMsg(error.response?.data?.message || 'Could not update account status.');
    }
  };

  if (loading) return <div className="panel-loading">Loading pending accounts…</div>;

  return (
    <div className="approval-panel">
      {msg && <div className="settings-notice" onAnimationEnd={() => setMsg('')}>{msg}</div>}
      {pendingUsers.length ? (
        <div className="approval-list">
          {pendingUsers.map((user) => (
            <article key={user._id} className="approval-card">
              <div>
                <strong>{user.name}</strong>
                <span>{user.email}</span>
                <small>{new Date(user.createdAt).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })}</small>
              </div>
              <div className="approval-actions">
                <button className="settings-btn primary" onClick={() => decide(user._id, 'approved')}>Approve</button>
                <button className="settings-btn danger" onClick={() => decide(user._id, 'rejected')}>Reject</button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="approval-state-card">
          <strong>No pending sign-up accounts</strong>
          <p>New user registrations will appear here until an administrator approves or rejects them.</p>
        </div>
      )}
    </div>
  );
};

const EmailPanel = () => {
  const [testEmail, setTestEmail] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  const sendTest = async () => {
    if (!testEmail) return;
    setLoading(true);
    setStatus('');
    try {
      await api.post('/auth/forgot-password', { email: testEmail });
      setStatus('✅ Test email sent (if address exists a reset link was delivered).');
    } catch {
      setStatus('❌ Failed to send test email. Check GMAIL_APP_PASSWORD in .env.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="email-panel">
      <p className="panel-desc">
        Emails are sent via Gmail SMTP using the App Password configured in <code>server/.env</code>.
      </p>
      <div className="email-row">
        <label>Configured sender:</label>
        <code className="env-val">
          {import.meta.env.VITE_HOST ? `emb.vera.ember@gmail.com` : 'emb.vera.ember@gmail.com'}
        </code>
      </div>
      <div className="test-email-row">
        <input
          type="email"
          className="settings-input"
          placeholder="Send test reset email to…"
          value={testEmail}
          onChange={(e) => setTestEmail(e.target.value)}
        />
        <button className="settings-btn primary" onClick={sendTest} disabled={loading || !testEmail}>
          {loading ? 'Sending…' : 'Send Test'}
        </button>
      </div>
      {status && <p className="email-status">{status}</p>}
    </div>
  );
};

const SECTIONS = [
  { id: 'accounts', label: 'User Accounts' },
  { id: 'approvals', label: 'Sign Up Approvals' },
  { id: 'runtime', label: 'App Runtime Status' },
  { id: 'database', label: 'Database Status' },
  { id: 'email', label: 'Email Config' },
  { id: 'theme', label: 'Theme & Display' },
];

const Settings = ({ initialSection = 'accounts' }) => {
  const { user } = useAuth();
  const { theme, toggle } = useTheme();
  const [active, setActive] = useState(initialSection);

  if (user?.role !== 'admin') {
    return (
      <div className="settings-denied">
        <span className="denied-icon">🔒</span>
        <h3>Access Denied</h3>
        <p>This section is restricted to administrators only.</p>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <div className="settings-header">
        <div>
          <h2 className="settings-title">Developer Manager</h2>
          <p className="settings-sub">Administrator-only panel for accounts, approvals, runtime health, and database status.</p>
        </div>
        <span className="admin-badge">Admin</span>
      </div>

      <div className="settings-layout">
        {/* Sidebar nav */}
        <nav className="settings-nav">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={`snav-item${active === s.id ? ' active' : ''}`}
              onClick={() => setActive(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="settings-content">
          {active === 'accounts' && (
            <section className="settings-section">
              <h3>User Accounts</h3>
              <p className="section-desc">
                View all registered users, change roles, and remove accounts.
              </p>
              <AccountsPanel currentUser={user} />
            </section>
          )}

          {active === 'approvals' && (
            <section className="settings-section">
              <h3>Sign Up Account Approval</h3>
              <p className="section-desc">Approval workflow readiness and pending sign-up queue.</p>
              <ApprovalsPanel />
            </section>
          )}

          {active === 'runtime' && (
            <section className="settings-section">
              <h3>App Runtime Status</h3>
              <p className="section-desc">Live server runtime diagnostics.</p>
              <SystemInfo mode="runtime" />
            </section>
          )}

          {active === 'database' && (
            <section className="settings-section">
              <h3>Database Status</h3>
              <p className="section-desc">MongoDB connection health from the server runtime.</p>
              <SystemInfo mode="database" />
            </section>
          )}

          {active === 'email' && (
            <section className="settings-section">
              <h3>Email Configuration</h3>
              <p className="section-desc">Test the Gmail SMTP integration.</p>
              <EmailPanel />
            </section>
          )}

          {active === 'theme' && (
            <section className="settings-section">
              <h3>Theme &amp; Display</h3>
              <p className="section-desc">Toggle light / dark mode for the entire app.</p>
              <div className="theme-toggle-row">
                <span className="theme-label">
                  {theme === 'light' ? 'Light Mode' : 'Dark Mode'}
                </span>
                <button
                  className={`theme-toggle-btn${theme === 'dark' ? ' dark' : ''}`}
                  onClick={toggle}
                >
                  <span className="toggle-knob" />
                </button>
              </div>
              <p className="section-note">
                Theme preference is saved in your browser and applied on every visit.
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};

export default Settings;

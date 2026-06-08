import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import {
  Alert, Button, Card, Col, Empty, Row, Space, Statistic, Table, Tag,
} from 'antd';
import { LineChartOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import api from '../api/axios';
import encryptedStorage from '../utils/encryptedStorage';
import { loadStationLocations } from '../utils/stationWorkbook';
import {
  buildWaterbodyOptions,
  getReadableStations,
  publishWqmYear,
  WQM_DRAFTS_KEY,
  WQM_PUBLISHED_YEAR_KEY,
  WQM_YEAR_OPTIONS,
  useWqmSheets,
} from '../utils/wqmSheets';
import { clearAppLogs, getAppLogs, logActivity } from '../utils/appLog';
import './Settings.css';

const ROLES = ['user', 'developer', 'admin'];
const STATUS_LABELS = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};
const VISUALIZATION_YEAR_OPTIONS = WQM_YEAR_OPTIONS.map((year) => [
  String(year),
  year === 2026 ? '2026 active dataset' : `${year} MongoDB dataset`,
]);
const TABLE_PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

const ACCESS_FEATURES = [
  ['dashboard', 'Dashboard', 'user'],
  ['visualizations', 'Visual Analytics', 'user'],
  ['waterbodies', 'Waterbody Profiles', 'user'],
  ['tabular', 'Tabular Results', 'user'],
  ['tabularCrud', 'Tabular CRUD', 'admin'],
  ['developerManager', 'Developer Manager', 'developer'],
];

const getStationAssignmentKey = (waterbodyKey, station) => [
  waterbodyKey,
  station?.stnNo ?? '',
  station?.stnId ?? '',
  station?.address ?? '',
].join('::');

const normalizeForMatch = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const getLocationStationNumber = (location) => {
  const match = String(location?.id || '').match(/(?:^|_)(\d+)$/);
  return match ? Number(match[1]) : null;
};

const matchStationLocation = (station, waterbody, stationLocations) => {
  const waterbodyName = normalizeForMatch(waterbody?.name);
  const stationNo = Number(station?.stnNo);
  const stationValues = [station?.stnId, station?.address].map(normalizeForMatch).filter(Boolean);
  return stationLocations.find((location) => {
    const locationWaterbody = normalizeForMatch(location.waterbodyRiver);
    if (waterbodyName && locationWaterbody && locationWaterbody !== waterbodyName) return false;
    if (Number.isFinite(stationNo) && getLocationStationNumber(location) === stationNo) return true;
    const locationValues = [location.station, location.barangay, location.province].map(normalizeForMatch).filter(Boolean);
    return stationValues.some((value) => locationValues.some((locationValue) => (
      value === locationValue || value.includes(locationValue) || locationValue.includes(value)
    )));
  }) || null;
};

const usePaginatedRows = (rows, defaultPageSize = 10) => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const start = (safePage - 1) * pageSize;
  const pagedRows = rows.slice(start, start + pageSize);

  return {
    page: safePage,
    pageSize,
    pageCount,
    total,
    start,
    rows: pagedRows,
    setPage,
    setPageSize: (nextSize) => {
      setPageSize(nextSize);
      setPage(1);
    },
  };
};

const TablePagination = ({ pagination, label = 'Rows' }) => {
  if (!pagination.total) return null;
  const first = pagination.total ? pagination.start + 1 : 0;
  const last = Math.min(pagination.start + pagination.pageSize, pagination.total);

  return (
    <div className="settings-pagination" aria-label={`${label} pagination`}>
      <span>{first}-{last} of {pagination.total}</span>
      <label>
        <span>Page size</span>
        <select value={pagination.pageSize} onChange={(event) => pagination.setPageSize(Number(event.target.value))}>
          {TABLE_PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
      </label>
      <button type="button" disabled={pagination.page <= 1} onClick={() => pagination.setPage(pagination.page - 1)}>Prev</button>
      <strong>{pagination.page} / {pagination.pageCount}</strong>
      <button type="button" disabled={pagination.page >= pagination.pageCount} onClick={() => pagination.setPage(pagination.page + 1)}>Next</button>
    </div>
  );
};

const getStoredAccessSettings = () => {
  try {
    const stored = encryptedStorage.getItem('wqms_access_settings');
    return Object.fromEntries(ACCESS_FEATURES.map(([key, , fallback]) => [key, stored?.[key] || fallback]));
  } catch {
    return Object.fromEntries(ACCESS_FEATURES.map(([key, , fallback]) => [key, fallback]));
  }
};

const USER_ACCESS_KEY = 'wqms_user_access';
const ACCESS_OVERRIDE_OPTIONS = [
  ['default', 'Role default'],
  ['allow', 'Allow'],
  ['deny', 'Deny'],
];

const getUserAccessOverrides = () => {
  try {
    return encryptedStorage.getItem(USER_ACCESS_KEY) || {};
  } catch {
    return {};
  }
};

const ManageAccessSettings = ({ currentUser }) => {
  const [settings, setSettings] = useState(getStoredAccessSettings);
  const [saved, setSaved] = useState('');

  const updateAccess = (feature, role) => {
    const next = { ...settings, [feature]: role };
    setSettings(next);
    encryptedStorage.setItem('wqms_access_settings', next);
    window.dispatchEvent(new CustomEvent('wqms:access-settings', { detail: next }));
    setSaved('Access settings saved.');
    logActivity('Updated app access settings', { feature, role }, currentUser);
  };

  return (
    <div className="access-settings-panel">
      <div className="access-settings-head">
        <div>
          <h4>Manage Access Settings</h4>
          <p>Set the minimum role allowed to open major app areas.</p>
        </div>
        {saved && <span onAnimationEnd={() => setSaved('')}>{saved}</span>}
      </div>
      <div className="access-settings-grid">
        {ACCESS_FEATURES.map(([key, label]) => (
          <label key={key}>
            <span>{label}</span>
            <select value={settings[key]} onChange={(event) => updateAccess(key, event.target.value)}>
              {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
          </label>
        ))}
      </div>
    </div>
  );
};

const VisualizationYearSettings = ({ currentUser }) => {
  const [year, setYear] = useState(() => encryptedStorage.getItem(WQM_PUBLISHED_YEAR_KEY) || '2026');
  const [saved, setSaved] = useState('');
  const [loading, setLoading] = useState(true);

  const publishYear = useCallback((nextYear) => {
    const normalized = String(publishWqmYear(nextYear));
    setYear(normalized);
  }, []);

  useEffect(() => {
    let mounted = true;
    api.get('/admin/settings/visualization-year')
      .then(({ data }) => {
        if (mounted) publishYear(data?.year || 2026);
      })
      .catch((error) => {
        if (mounted) setSaved(error.response?.data?.message || 'Using local published WQM year until server setting loads.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, [publishYear]);

  const updateYear = async (nextYear) => {
    publishYear(nextYear);
    setSaved('');
    try {
      const { data } = await api.patch('/admin/settings/visualization-year', { year: Number(nextYear) });
      publishYear(data?.year || nextYear);
      setSaved(`Published WQM year set to ${data?.year || nextYear}.`);
      logActivity('Updated published WQM year', { year: String(data?.year || nextYear) }, currentUser);
    } catch (error) {
      setSaved(error.response?.data?.message || 'Unable to save published WQM year to MongoDB.');
    }
  };

  return (
    <div className="access-settings-panel">
      <div className="access-settings-head">
        <div>
          <h4>Published WQM Year</h4>
          <p>Sets the WQM dataset used by dashboard, visual analytics, and monitoring. The selection is saved in MongoDB and shared across sessions.</p>
        </div>
        {saved && <span onAnimationEnd={() => setSaved('')}>{saved}</span>}
      </div>
      <div className="access-settings-grid compact">
        <label>
          <span>WQM Year to Publish</span>
          <select value={year} disabled={loading} onChange={(event) => updateYear(event.target.value)}>
            {VISUALIZATION_YEAR_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
};

const WaterbodyProfileSettings = ({ currentUser }) => {
  const sheets = useWqmSheets();
  const waterbodies = useMemo(() => buildWaterbodyOptions(sheets), [sheets]);
  const [stationLocations, setStationLocations] = useState([]);
  const [settings, setSettings] = useState(() => {
    try {
      return encryptedStorage.getItem('wqms_waterbody_profile_settings') || {};
    } catch {
      return {};
    }
  });
  const [saved, setSaved] = useState('');
  const activeKey = waterbodies[0]?.key || '';
  const [selectedKey, setSelectedKey] = useState(activeKey);
  const selectedWaterbody = waterbodies.find((item) => item.key === selectedKey) || waterbodies[0];
  const selectedSheet = sheets.find((sheet) => sheet.key === selectedWaterbody?.key);
  const selectedStations = useMemo(() => getReadableStations(selectedSheet), [selectedSheet]);
  const current = settings[selectedWaterbody?.key] || {};
  const stationAssignments = current.stationAssignments || {};
  const stationOverrides = current.stationOverrides || {};

  useEffect(() => {
    let cancelled = false;
    loadStationLocations()
      .then((locations) => {
        if (!cancelled) setStationLocations(locations);
      })
      .catch(() => {
        if (!cancelled) setStationLocations([]);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedKey && activeKey) {
      queueMicrotask(() => setSelectedKey(activeKey));
    }
  }, [activeKey, selectedKey]);

  const updateSetting = (field, value) => {
    if (!selectedWaterbody) return;
    const next = {
      ...settings,
      [selectedWaterbody.key]: {
        ...current,
        [field]: value,
      },
    };
    setSettings(next);
    encryptedStorage.setItem('wqms_waterbody_profile_settings', next);
    window.dispatchEvent(new CustomEvent('wqms:waterbody-profile-settings', { detail: next }));
    setSaved('Waterbody profile settings saved.');
    logActivity('Updated waterbody profile settings', { waterbody: selectedWaterbody.name, field }, currentUser);
  };

  const updateStationAssignment = (station, targetWaterbodyKey) => {
    if (!selectedWaterbody) return;
    const assignmentKey = getStationAssignmentKey(selectedWaterbody.key, station);
    const nextAssignments = { ...stationAssignments };
    if (!targetWaterbodyKey || targetWaterbodyKey === selectedWaterbody.key) {
      delete nextAssignments[assignmentKey];
    } else {
      nextAssignments[assignmentKey] = targetWaterbodyKey;
    }
    updateSetting('stationAssignments', nextAssignments);
  };

  const updateStationOverride = (station, field, value) => {
    if (!selectedWaterbody) return;
    const assignmentKey = getStationAssignmentKey(selectedWaterbody.key, station);
    const nextOverrides = {
      ...stationOverrides,
      [assignmentKey]: {
        ...(stationOverrides[assignmentKey] || {}),
        [field]: value,
      },
    };
    updateSetting('stationOverrides', nextOverrides);
  };

  return (
    <div className="waterbody-settings-panel">
      <div className="settings-toolbar">
        <label className="settings-field">
          <span>Waterbody</span>
          <select value={selectedWaterbody?.key || ''} onChange={(event) => setSelectedKey(event.target.value)}>
            {waterbodies.map((waterbody) => <option key={waterbody.key} value={waterbody.key}>{waterbody.name}</option>)}
          </select>
        </label>
        {saved && <p className="email-status" onAnimationEnd={() => setSaved('')}>{saved}</p>}
      </div>
      {selectedWaterbody && (
        <div className="waterbody-settings-grid">
          <label>
            <span>Profile Name</span>
            <input value={current.profileName || selectedWaterbody.name} onChange={(event) => updateSetting('profileName', event.target.value)} />
          </label>
          <label>
            <span>Waterbody Assignment</span>
            <input value={current.assignedWaterbody || selectedWaterbody.name} onChange={(event) => updateSetting('assignedWaterbody', event.target.value)} />
          </label>
          <label>
            <span>Station Location Source</span>
            <select value={current.locationSource || 'workbook'} onChange={(event) => updateSetting('locationSource', event.target.value)}>
              <option value="workbook">Workbook station list</option>
              <option value="manual">Manual assignment</option>
            </select>
          </label>
          <label>
            <span>Profile Notes</span>
            <textarea value={current.notes || ''} onChange={(event) => updateSetting('notes', event.target.value)} />
          </label>
        </div>
      )}
      {selectedWaterbody && (
        <div className="station-regroup-panel">
          <div className="station-regroup-head">
            <div>
              <h4>Station Regrouping</h4>
              <p>Move stations from this waterbody into another available waterbody for profile and location organization.</p>
            </div>
            <span>{selectedStations.length} stations</span>
          </div>
          <div className="station-regroup-table-wrap">
            <table className="station-regroup-table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Station</th>
                  <th>Coordinates</th>
                  <th>Address</th>
                  <th>Assigned Waterbody</th>
                </tr>
              </thead>
              <tbody>
                {selectedStations.map((station) => {
                  const assignmentKey = getStationAssignmentKey(selectedWaterbody.key, station);
                  const assignedKey = stationAssignments[assignmentKey] || selectedWaterbody.key;
                  const override = stationOverrides[assignmentKey] || {};
                  const location = matchStationLocation(station, selectedWaterbody, stationLocations);
                  const stationName = override.name ?? station.stnId ?? '';
                  const lat = override.lat ?? (Number.isFinite(location?.lat) ? String(location.lat) : '');
                  const lng = override.lng ?? (Number.isFinite(location?.lng) ? String(location.lng) : '');
                  return (
                    <tr key={assignmentKey}>
                      <td>{station.stnNo}</td>
                      <td>
                        <input
                          value={stationName}
                          onChange={(event) => updateStationOverride(station, 'name', event.target.value)}
                          aria-label={`Station name for ${station.stnId}`}
                        />
                      </td>
                      <td>
                        <div className="station-coordinate-fields">
                          <input
                            inputMode="decimal"
                            value={lat}
                            onChange={(event) => updateStationOverride(station, 'lat', event.target.value)}
                            aria-label={`Latitude for ${station.stnId}`}
                          />
                          <input
                            inputMode="decimal"
                            value={lng}
                            onChange={(event) => updateStationOverride(station, 'lng', event.target.value)}
                            aria-label={`Longitude for ${station.stnId}`}
                          />
                        </div>
                      </td>
                      <td>{station.address || 'Address not specified'}</td>
                      <td>
                        <select value={assignedKey} onChange={(event) => updateStationAssignment(station, event.target.value)}>
                          {waterbodies.map((waterbody) => (
                            <option key={waterbody.key} value={waterbody.key}>{waterbody.name}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
                {!selectedStations.length && (
                  <tr>
                    <td colSpan="5" className="empty-log-cell">No stations are available for this waterbody.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

const SystemInfo = ({ mode = 'all' }) => {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    api.get('/admin/system').then((r) => setInfo(r.data)).catch(() => {});
  }, []);

  if (!info) return <div className="panel-loading">Loading runtime status...</div>;

  const uptimeHours = Math.floor(info.uptime / 3600);
  const uptimeMinutes = Math.floor((info.uptime % 3600) / 60);
  const runtimeRows = [
    ['Node.js', info.nodeVersion],
    ['Platform', info.platform],
    ['Hostname', info.hostname],
    ['Environment', info.env],
    ['Memory Used', `${info.memoryMB} MB`],
    ['Uptime', `${uptimeHours}h ${uptimeMinutes}m`],
  ];
  const databaseRows = [
    ['DB Status', info.dbStatus],
    ['DB Name', info.dbName || 'Not connected'],
  ];
  const rows = mode === 'runtime' ? runtimeRows : mode === 'database' ? databaseRows : [...runtimeRows, ...databaseRows];
  const memoryData = [
    { name: 'Used', value: info.memoryMB, color: '#446ACB' },
    { name: 'Reserve', value: Math.max(256 - info.memoryMB, 24), color: '#D6DBF6' },
  ];
  const runtimeSeries = [
    { name: 'Start', memory: Math.max(info.memoryMB - 18, 8), uptime: 0 },
    { name: 'Now', memory: info.memoryMB, uptime: Math.max(uptimeHours, 1) },
  ];
  const barData = [
    { name: 'Memory MB', value: info.memoryMB },
    { name: 'Uptime Hrs', value: Math.max(uptimeHours, 1) },
  ];

  return (
    <div className="runtime-dashboard">
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

      {mode !== 'database' && (
        <div className="runtime-visual-grid">
          <article>
            <h4>Resource Share</h4>
            <ResponsiveContainer width="100%" height={190}>
              <PieChart>
                <Pie data={memoryData} dataKey="value" innerRadius={46} outerRadius={76} paddingAngle={4}>
                  {memoryData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </article>
          <article>
            <h4>Runtime Monitor</h4>
            <ResponsiveContainer width="100%" height={190}>
              <LineChart data={runtimeSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="memory" stroke="#446ACB" strokeWidth={2.4} dot />
                <Line type="monotone" dataKey="uptime" stroke="#7CB675" strokeWidth={2.4} dot />
              </LineChart>
            </ResponsiveContainer>
          </article>
          <article>
            <h4>Health Bars</h4>
            <ResponsiveContainer width="100%" height={190}>
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" fill="#7CB675" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </article>
        </div>
      )}
    </div>
  );
};

const AccountsPanel = ({ currentUser }) => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [editingUser, setEditingUser] = useState(null);
  const [userDraft, setUserDraft] = useState(null);
  const [userAccessDraft, setUserAccessDraft] = useState({});
  const userPagination = usePaginatedRows(users, 10);

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
      logActivity('Changed user role', { user: data.email, role }, currentUser);
    } catch (e) {
      setMsg(e.response?.data?.message || 'Error updating role.');
    }
  };

  const changeStatus = async (id, status) => {
    try {
      const { data } = await api.patch(`/admin/users/${id}/status`, { status });
      setUsers((prev) => prev.map((u) => (u._id === data._id ? data : u)));
      setMsg(`Account status updated to "${status}".`);
      logActivity('Changed user status', { user: data.email, status }, currentUser);
    } catch (e) {
      setMsg(e.response?.data?.message || 'Error updating account status.');
    }
  };

  const deleteUser = async (id, name) => {
    if (!window.confirm(`Delete user "${name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/admin/users/${id}`);
      setUsers((prev) => prev.filter((u) => u._id !== id));
      const overrides = getUserAccessOverrides();
      if (overrides[id]) {
        const { [id]: _removed, ...rest } = overrides;
        encryptedStorage.setItem(USER_ACCESS_KEY, rest);
        window.dispatchEvent(new CustomEvent('wqms:access-settings', { detail: rest }));
      }
      setMsg(`User "${name}" deleted.`);
      logActivity('Deleted user account', { user: name }, currentUser);
    } catch (e) {
      setMsg(e.response?.data?.message || 'Error deleting user.');
    }
  };

  const openUserModal = (user) => {
    setEditingUser(user);
    setUserDraft({
      name: user.name || '',
      email: user.email || '',
      role: user.role || 'user',
      status: user.status || 'approved',
    });
    setUserAccessDraft({ ...(getUserAccessOverrides()[user._id] || {}) });
  };

  const updateUserAccess = (feature, value) => {
    if (!editingUser) return;
    setUserAccessDraft((draft) => {
      const nextDraft = { ...draft };
      if (value === 'default') delete nextDraft[feature];
      else nextDraft[feature] = value;
      const updated = { ...getUserAccessOverrides() };
      if (Object.keys(nextDraft).length) updated[editingUser._id] = nextDraft;
      else delete updated[editingUser._id];
      encryptedStorage.setItem(USER_ACCESS_KEY, updated);
      window.dispatchEvent(new CustomEvent('wqms:access-settings', { detail: updated }));
      logActivity('Updated user access override', { user: editingUser.email, feature, value }, currentUser);
      return nextDraft;
    });
  };

  const saveUserDetails = async () => {
    if (!editingUser || !userDraft) return;
    try {
      const { data } = await api.patch(`/admin/users/${editingUser._id}`, userDraft);
      setUsers((prev) => prev.map((u) => (u._id === data._id ? data : u)));
      setMsg('User details updated.');
      logActivity('Updated user details', { user: data.email }, currentUser);
      setEditingUser(null);
      setUserDraft(null);
    } catch (e) {
      setMsg(e.response?.data?.message || 'Error updating user details.');
    }
  };

  if (loading) return <div className="panel-loading">Loading users...</div>;

  return (
    <div className="accounts-panel">
      {msg && <div className="settings-notice" onAnimationEnd={() => setMsg('')}>{msg}</div>}
      <ManageAccessSettings currentUser={currentUser} />
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
            {userPagination.rows.map((u, i) => (
              <tr key={u._id} className={u._id === currentUser._id ? 'row-self' : ''}>
                <td className="td-num">{userPagination.start + i + 1}</td>
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
                  {new Date(u.createdAt).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })}
                </td>
                <td>
                  {u._id !== currentUser._id ? (
                    <div className="user-action-group">
                      <button className="mini-action" onClick={() => openUserModal(u)}>Manage</button>
                      {u.status !== 'approved' && <button className="mini-action ok" onClick={() => changeStatus(u._id, 'approved')}>Approve</button>}
                      {u.status !== 'pending' && <button className="mini-action" onClick={() => changeStatus(u._id, 'pending')}>Hold</button>}
                      {u.status !== 'rejected' && <button className="mini-action warn" onClick={() => changeStatus(u._id, 'rejected')}>Reject</button>}
                      <button className="mini-action danger" onClick={() => deleteUser(u._id, u.name)}>Delete</button>
                    </div>
                  ) : <button className="mini-action" onClick={() => openUserModal(u)}>Manage</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TablePagination pagination={userPagination} label="User accounts" />
      {editingUser && userDraft && (
        <div className="settings-modal-backdrop" role="presentation" onClick={() => setEditingUser(null)}>
          <section className="settings-user-modal" role="dialog" aria-modal="true" aria-label="Manage user access" onClick={(event) => event.stopPropagation()}>
            <div className="settings-user-modal-head">
              <div>
                <h4>Manage User Access</h4>
                <p>{editingUser.email}</p>
              </div>
              <button type="button" onClick={() => setEditingUser(null)}>x</button>
            </div>
            <div className="settings-user-form">
              <label>
                <span>Name</span>
                <input value={userDraft.name} onChange={(event) => setUserDraft((draft) => ({ ...draft, name: event.target.value }))} />
              </label>
              <label>
                <span>Email</span>
                <input value={userDraft.email} onChange={(event) => setUserDraft((draft) => ({ ...draft, email: event.target.value }))} />
              </label>
              <label>
                <span>Role</span>
                <select
                  value={userDraft.role}
                  disabled={editingUser._id === currentUser._id}
                  onChange={(event) => setUserDraft((draft) => ({ ...draft, role: event.target.value }))}
                >
                  {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
              </label>
              <label>
                <span>Status</span>
                <select
                  value={userDraft.status}
                  disabled={editingUser._id === currentUser._id}
                  onChange={(event) => setUserDraft((draft) => ({ ...draft, status: event.target.value }))}
                >
                  {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            </div>
            <div className="settings-user-access">
              <div className="settings-user-access-head">
                <h5>Manage Access Settings</h5>
                <p>Override role-based access for this account. &quot;Role default&quot; follows the global minimum-role rule.</p>
              </div>
              <div className="settings-user-access-grid">
                {ACCESS_FEATURES.map(([key, label]) => (
                  <label key={key}>
                    <span>{label}</span>
                    <select
                      value={userAccessDraft[key] || 'default'}
                      onChange={(event) => updateUserAccess(key, event.target.value)}
                    >
                      {ACCESS_OVERRIDE_OPTIONS.map(([value, optionLabel]) => <option key={value} value={value}>{optionLabel}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </div>
            <div className="settings-user-modal-actions">
              <button className="settings-btn" type="button" onClick={() => setEditingUser(null)}>Cancel</button>
              <button className="settings-btn primary" type="button" onClick={saveUserDetails}>Save Changes</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

const ApprovalsPanel = ({ currentUser }) => {
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
      logActivity('Reviewed pending sign-up', { status, id }, currentUser);
    } catch (error) {
      setMsg(error.response?.data?.message || 'Could not update account status.');
    }
  };

  if (loading) return <div className="panel-loading">Loading pending accounts...</div>;

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
          <p>New user registrations will appear here until an administrator or developer approves or rejects them.</p>
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
      setStatus('Test email sent if the address exists.');
    } catch {
      setStatus('Failed to send test email. Check Gmail SMTP configuration.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="email-panel">
      <p className="panel-desc">Emails are sent via Gmail SMTP using the App Password configured in the server environment.</p>
      <div className="email-row">
        <label>Configured sender:</label>
        <code className="env-val">emb.vera.ember@gmail.com</code>
      </div>
      <div className="test-email-row">
        <input
          type="email"
          className="settings-input"
          placeholder="Send test reset email to..."
          value={testEmail}
          onChange={(e) => setTestEmail(e.target.value)}
        />
        <button className="settings-btn primary" onClick={sendTest} disabled={loading || !testEmail}>
          {loading ? 'Sending...' : 'Send Test'}
        </button>
      </div>
      {status && <p className="email-status">{status}</p>}
    </div>
  );
};

const LogsPanel = ({ user }) => {
  const [logs, setLogs] = useState(getAppLogs());
  const logsPagination = usePaginatedRows(logs, 10);
  const actionData = useMemo(() => {
    const counts = logs.reduce((acc, log) => {
      acc[log.action] = (acc[log.action] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(counts).slice(0, 6).map(([name, value]) => ({ name, value }));
  }, [logs]);

  useEffect(() => {
    const refresh = () => setLogs(getAppLogs());
    window.addEventListener('wqms:log', refresh);
    return () => window.removeEventListener('wqms:log', refresh);
  }, []);

  const exportLogs = () => {
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `wqms_app_logs_${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const clearLogs = () => {
    clearAppLogs();
    logActivity('Cleared app logs', {}, user);
    setLogs(getAppLogs());
  };

  return (
    <div className="logs-panel">
      <div className="settings-toolbar">
        <button className="settings-btn primary" onClick={exportLogs} disabled={!logs.length}>Export Logs</button>
        <button className="settings-btn danger" onClick={clearLogs} disabled={!logs.length}>Clear Logs</button>
      </div>
      <div className="log-visual">
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={actionData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="value" fill="#446ACB" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="users-table-wrap">
        <table className="users-table logs-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {logsPagination.rows.map((log) => (
              <tr key={log.id}>
                <td className="td-date">{new Date(log.at).toLocaleString('en-PH')}</td>
                <td>{log.actor}<span className="log-role">{log.role}</span></td>
                <td><strong>{log.action}</strong></td>
                <td><code>{JSON.stringify(log.details || {})}</code></td>
              </tr>
            ))}
            {!logs.length && <tr><td colSpan="4" className="empty-log-cell">No app activities have been logged yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <TablePagination pagination={logsPagination} label="App logs" />
    </div>
  );
};

const BackupPanel = ({ user }) => {
  const [status, setStatus] = useState('');
  const backupRows = [
    { name: 'Tabular Drafts', value: encryptedStorage.getItem(WQM_DRAFTS_KEY) ? 'Available' : 'No local draft' },
    { name: 'App Logs', value: `${getAppLogs().length} records` },
    { name: 'Theme Config', value: encryptedStorage.getItem('wqm_theme') || 'default' },
  ];

  const exportBackup = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      app: 'EMBR3-WQMS',
      localDrafts: encryptedStorage.getItem(WQM_DRAFTS_KEY),
      appLogs: getAppLogs(),
      theme: encryptedStorage.getItem('wqm_theme'),
      config: { basePath: '/water-quality-monitoring', host: '10.14.77.183', port: 5173 },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `wqms_backup_${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    logActivity('Exported app backup', { includes: ['drafts', 'logs', 'theme', 'config'] }, user);
    setStatus('Backup export generated.');
  };

  const importBackup = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const payload = JSON.parse(text);
    if (payload.localDrafts) encryptedStorage.setItem(WQM_DRAFTS_KEY, payload.localDrafts);
    if (payload.appLogs) encryptedStorage.setItem('wqms_app_logs', payload.appLogs);
    if (payload.theme) encryptedStorage.setItem('wqm_theme', payload.theme);
    logActivity('Imported app backup', { file: file.name }, user);
    setStatus('Backup imported. Refresh the app to reload restored local data.');
  };

  return (
    <div className="backup-panel">
      <div className="backup-grid">
        {backupRows.map((row) => (
          <article key={row.name} className="backup-card">
            <span>{row.name}</span>
            <strong>{row.value}</strong>
          </article>
        ))}
      </div>
      <div className="settings-toolbar">
        <button className="settings-btn primary" onClick={exportBackup}>Export Backup</button>
        <label className="settings-btn import-btn">
          Import Backup
          <input type="file" accept="application/json" onChange={importBackup} />
        </label>
      </div>
      {status && <p className="email-status">{status}</p>}
    </div>
  );
};

const AiForecastPanel = () => {
  const [status, setStatus] = useState(null);
  const [readings, setReadings] = useState([]);
  const [message, setMessage] = useState('');

  const refreshStatus = useCallback(() => {
    setMessage('');
    Promise.all([
      api.get('/water/forecast/status'),
      api.get('/water/readings'),
    ])
      .then(([statusResponse, readingsResponse]) => {
        setStatus(statusResponse.data);
        setReadings(Array.isArray(readingsResponse.data) ? readingsResponse.data : []);
      })
      .catch((error) => setMessage(error.response?.data?.message || 'Unable to read AI forecast status.'));
  }, []);

  useEffect(() => {
    queueMicrotask(refreshStatus);
  }, [refreshStatus]);

  const latestReading = readings[0];
  const localEngines = status?.localEngines || [];

  const readingColumns = [
    { title: 'Station', dataIndex: 'location', key: 'location' },
    { title: 'pH', dataIndex: 'ph', key: 'ph' },
    { title: 'Turbidity', dataIndex: 'turbidity', key: 'turbidity' },
    { title: 'Temp.', dataIndex: 'temperature', key: 'temperature' },
    { title: 'DO', dataIndex: 'dissolved_oxygen', key: 'do' },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (value) => (
        <Tag color={value === 'critical' ? 'red' : value === 'warning' ? 'gold' : 'green'}>
          {value}
        </Tag>
      ),
    },
  ];

  return (
    <Space direction="vertical" size="large" className="ai-config-panel" style={{ width: '100%' }}>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic
              title="AI Status"
              value={status?.configured ? 'Ready' : 'Not ready'}
              valueStyle={{ color: status?.configured ? '#16a34a' : '#d97706' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic title="Google AI API Key" value={status?.configured ? 'Configured' : 'Not detected'} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic title="AI Forecast Model" value={status?.model || 'Checking...'} />
          </Card>
        </Col>
      </Row>

      <Card size="small" title="Local forecast engines" className="ai-engines-card">
        <Row gutter={[16, 16]}>
          {localEngines.map((engine) => (
            <Col xs={24} sm={12} key={engine.id}>
              <Card size="small" type="inner" title={<Space><LineChartOutlined />{engine.label}</Space>}>
                <p style={{ margin: 0 }}>{engine.description}</p>
              </Card>
            </Col>
          ))}
          {!localEngines.length && (
            <Col span={24}><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No local engines reported." /></Col>
          )}
        </Row>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12}>
          <Card size="small">
            <Statistic title="Current Monitoring Feed" value={readings.length} suffix="readings" />
            <small>{latestReading?.date ? new Date(latestReading.date).toLocaleString('en-PH') : 'No timestamp available'}</small>
          </Card>
        </Col>
        <Col xs={24} sm={12}>
          <Card size="small">
            <Statistic title="Latest Station" value={latestReading?.location || 'No readings'} />
            <small>{latestReading?.status || 'n/a'}</small>
          </Card>
        </Col>
      </Row>

      <Table
        size="small"
        rowKey={(row) => row.id}
        columns={readingColumns}
        dataSource={readings}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        locale={{ emptyText: 'No current monitoring readings loaded.' }}
        scroll={{ x: 'max-content' }}
      />

      <Space>
        <Button type="primary" icon={<ReloadOutlined />} onClick={refreshStatus}>Check AI Status</Button>
      </Space>

      <Alert
        type="info"
        showIcon
        message="Forecast configuration"
        description={`Recommended AI model: ${status?.recommendedModel || 'gemini-2.5-flash'}. Add GEMINI_API_KEY in server/.env (optional GEMINI_MODEL to override). The Prophet and OLS engines run in-browser on the Forecast Charts page and need no API key.`}
      />

      {message && <Alert type="error" showIcon message={message} />}
    </Space>
  );
};

const Settings = ({ initialSection = 'accounts' }) => {
  const { user } = useAuth();
  const { theme, toggle } = useTheme();
  const active = initialSection;

  if (!['admin', 'developer'].includes(user?.role)) {
    return (
      <div className="settings-denied">
        <span className="denied-icon">!</span>
        <h3>Access Denied</h3>
        <p>This section is restricted to administrators and developers only.</p>
      </div>
    );
  }

  return (
    <div className="settings-page">
      {/* <div className="settings-header">
        <div>
          <h2 className="settings-title">Developer Manager</h2>
          <p className="settings-sub">Accounts, approvals, runtime health, logs, and backup controls.</p>
        </div>
        <span className="admin-badge">{user?.role === 'developer' ? 'Developer' : 'Admin'}</span>
      </div> */}

      <div className="settings-layout settings-layout-single">
        <div className="settings-content">
          {active === 'accounts' && (
            <section className="settings-section">
              <h3>User Accounts</h3>
              <p className="section-desc">Manage roles, approval states, and account-level actions.</p>
              <AccountsPanel currentUser={user} />
            </section>
          )}

          {active === 'approvals' && (
            <section className="settings-section">
              <h3>Sign Up Account Approval</h3>
              <p className="section-desc">Review pending sign-up requests.</p>
              <ApprovalsPanel currentUser={user} />
            </section>
          )}

          {active === 'runtime' && (
            <section className="settings-section">
              <h3>App Runtime Status</h3>
              <p className="section-desc">Live server diagnostics with compact monitoring charts.</p>
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

          {active === 'waterbody-settings' && (
            <section className="settings-section">
              <h3>Waterbody Profiles & Station Locations</h3>
              <p className="section-desc">Configure profile labels, location source, and station-to-waterbody assignment metadata.</p>
              <WaterbodyProfileSettings currentUser={user} />
            </section>
          )}

          {active === 'logs' && (
            <section className="settings-section">
              <h3>App Logs</h3>
              <p className="section-desc">Track CRUD, exports, account changes, navigation, and backup operations.</p>
              <LogsPanel user={user} />
            </section>
          )}

          {active === 'visualization-data' && (
            <section className="settings-section">
              <h3>Published WQM Dataset</h3>
              <p className="section-desc">Choose which WQM year dashboard, visual analytics, and monitoring should display.</p>
              <VisualizationYearSettings currentUser={user} />
            </section>
          )}

          {active === 'backup' && (
            <section className="settings-section">
              <h3>Backup Export & Config</h3>
              <p className="section-desc">Export or restore local drafts, app logs, display settings, and runtime config metadata.</p>
              <BackupPanel user={user} />
            </section>
          )}

          {active === 'email' && (
            <section className="settings-section">
              <h3>Email Configuration</h3>
              <p className="section-desc">Test the Gmail SMTP integration.</p>
              <EmailPanel />
            </section>
          )}

          {active === 'ai' && (
            <section className="settings-section">
              <h3>AI Forecast</h3>
              <p className="section-desc">Check Google AI readiness for predictive trend previews.</p>
              <VisualizationYearSettings currentUser={user} />
              <AiForecastPanel />
            </section>
          )}

          {active === 'theme' && (
            <section className="settings-section">
              <h3>Theme & Display</h3>
              <p className="section-desc">Toggle light or dark mode for the entire app.</p>
              <div className="theme-toggle-row">
                <span className="theme-label">{theme === 'light' ? 'Light Mode' : 'Dark Mode'}</span>
                <button className={`theme-toggle-btn${theme === 'dark' ? ' dark' : ''}`} onClick={toggle}>
                  <span className="toggle-knob" />
                </button>
              </div>
              <p className="section-note">Theme preference is saved in your browser and applied on every visit.</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};

export default Settings;

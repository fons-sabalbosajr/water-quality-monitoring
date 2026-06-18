import { useEffect, useMemo, useState } from 'react';
import { Button, Input, Layout, Modal, Popconfirm, Space, Table, Tag } from 'antd';
import {
  DownOutlined,
  DeleteOutlined, DownloadOutlined, EditOutlined, EyeOutlined, PlusOutlined,
  ReloadOutlined, SearchOutlined,
  RightOutlined,
} from '@ant-design/icons';
import 'antd/dist/reset.css';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';
import { logActivity } from '../utils/appLog';
import { toastSaved } from '../utils/swal';
import encryptedStorage from '../utils/encryptedStorage';
import {
  MONTHS_SHORT, PARAM_LIMITS, fmt, getAvailableParams, getParamData,
  getParamUnit, normalizeParamName, OBSERVATION_PARAM, toNumber,
} from '../utils/wqmData';
import {
  INITIAL_SHEETS, WATERBODY_PROVINCE, getStoredWqmSheets,
  resetStoredWqmSheets, saveStoredWqmSheets,
  isCustomTabularYear, removeTabularYear,
} from '../utils/wqmSheets';
import './WQM2026.css';

const { Sider, Content } = Layout;

const clone = (value) => JSON.parse(JSON.stringify(value));
const normalizeMonthly = (monthly = []) => Array.from({ length: 12 }, (_, index) => monthly[index] ?? null);
const getYearDraftKey = (year) => `wqm_${year}_drafts`;

// 2026 (bundled active dataset) and any admin-created custom year are stored
// entirely in encrypted local storage. Only the legacy 2024/2025 archives are
// fetched from MongoDB.
const isLocalYear = (year) => year === 2026 || isCustomTabularYear(year);

const getStoredSheetsForYear = (year, fallback = INITIAL_SHEETS) => {
  if (year === 2026) return getStoredWqmSheets();
  const stored = encryptedStorage.getItem(getYearDraftKey(year));
  if (stored) return stored;
  return isCustomTabularYear(year) ? [] : clone(fallback);
};

const saveStoredSheetsForYear = (year, sheets) => {
  if (year === 2026) {
    saveStoredWqmSheets(sheets);
    return;
  }
  encryptedStorage.setItem(getYearDraftKey(year), sheets);
};

const resetStoredSheetsForYear = (year) => {
  if (year === 2026) {
    resetStoredWqmSheets();
    return;
  }
  encryptedStorage.removeItem(getYearDraftKey(year));
};

const computeAnnualAverage = (monthly = []) => {
  const values = normalizeMonthly(monthly).map(toNumber).filter((value) => value !== null);
  if (!values.length) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
};

const parseEditableValue = (value) => {
  const cleaned = String(value ?? '').trim();
  if (!cleaned || cleaned === '-' || cleaned === '—') return null;
  if (cleaned === '*') return '*';
  if (/^</.test(cleaned)) return cleaned;
  const numeric = Number(cleaned.replace(/,/g, ''));
  return Number.isFinite(numeric) ? numeric : cleaned;
};

const getDisplayParamName = (param) => (normalizeParamName(param) === OBSERVATION_PARAM ? 'Observations' : param);

const getWqgStandard = (param) => {
  const norm = normalizeParamName(param);
  if (norm === OBSERVATION_PARAM) return null;
  const limit = PARAM_LIMITS[norm];
  if (!limit) return null;
  const unit = limit.unit ? ` ${limit.unit}` : '';
  if (limit.min !== undefined && limit.max !== undefined)
    return `${limit.min} – ${limit.max}${unit}`;
  if (limit.min !== undefined) return `≥ ${limit.min}${unit}`;
  if (limit.max !== undefined) return `≤ ${limit.max}${unit}`;
  return null;
};

const isFilledMonthValue = (value) => value !== null && value !== undefined && value !== '';

const getParamStorageKey = (station, displayParam) => (
  Object.keys(station.params || {}).find((key) => normalizeParamName(key) === normalizeParamName(displayParam)) || displayParam
);

const buildStationDraft = (station, params) => ({
  stnNo: station?.stnNo ?? '',
  stnId: station?.stnId ?? '',
  address: station?.address ?? '',
  params: Object.fromEntries(params.map((param) => {
    const data = station ? getParamData(station, param) : null;
    return [param, {
      monthly: normalizeMonthly(data?.monthly).map((value) => value ?? ''),
      avg: computeAnnualAverage(data?.monthly) ?? data?.avg ?? '',
    }];
  })),
});

const WQM2026 = ({ year = 2026, onYearDeleted }) => {
  const { user } = useAuth();
  const canManageData = ['admin', 'developer'].includes(user?.role);
  const canEditYear = canManageData;
  const hasStoredSheetsForYear = (year) => Boolean(encryptedStorage.getItem(getYearDraftKey(year)));
  const [sheets, setSheets] = useState(() => (isLocalYear(year) ? getStoredSheetsForYear(year) : []));
  const [sourceSheets, setSourceSheets] = useState(() => (year === 2026 ? clone(INITIAL_SHEETS) : []));
  const [loading, setLoading] = useState(!isLocalYear(year));
  const [activeTab, setActiveTab] = useState('');
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [modalMode, setModalMode] = useState(null);
  const [editingStation, setEditingStation] = useState(null);
  const [stationDraft, setStationDraft] = useState(null);
  const [collapsedProvinces, setCollapsedProvinces] = useState({});
  const [waterbodyModalOpen, setWaterbodyModalOpen] = useState(false);
  const [waterbodyDraft, setWaterbodyDraft] = useState(null);
  const [waterbodyDraftError, setWaterbodyDraftError] = useState('');

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setSearch('');
        setMessage('');
      }
    });
    const hasDraft = hasStoredSheetsForYear(year);

    if (isLocalYear(year)) {
      const fallbackSource = year === 2026 ? INITIAL_SHEETS : [];
      const localSheets = getStoredSheetsForYear(year, fallbackSource);
      queueMicrotask(() => {
        if (!cancelled) {
          setMessage(
            year === 2026
              ? (hasDraft ? `WQM ${year} loaded from encrypted local draft.` : `WQM ${year} loaded from the bundled source dataset.`)
              : `Monitoring year ${year} loaded from encrypted local draft.`,
          );
          setLoading(false);
          setSourceSheets(year === 2026 ? clone(INITIAL_SHEETS) : clone(localSheets));
          setSheets(localSheets);
          setActiveTab(localSheets[0]?.key || '');
        }
      });
      return undefined;
    }

    queueMicrotask(() => {
      if (!cancelled) {
        setLoading(true);
        setSheets([]);
        setActiveTab('');
      }
    });
    api.get(`/water/wqm/${year}`)
      .then((response) => {
        if (cancelled) return;
        const loadedSheets = response.data?.sheets || [];
        const nextHasDraft = hasStoredSheetsForYear(year);
        const draftSheets = getStoredSheetsForYear(year, loadedSheets);
        setSourceSheets(clone(loadedSheets));
        setSheets(draftSheets);
        setActiveTab(draftSheets[0]?.key || '');
        setMessage(nextHasDraft ? `WQM ${year} loaded from encrypted local draft.` : `WQM ${year} loaded from MongoDB.`);
      })
      .catch((error) => {
        if (cancelled) return;
        setMessage(error.response?.data?.message || `Unable to load WQM ${year} from MongoDB.`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [year]);

  const sheet = sheets.find((item) => item.key === activeTab) || sheets[0];
  const params = useMemo(() => (sheet ? getAvailableParams(sheet.stations, false) : []), [sheet]);
  const modalParams = useMemo(() => (sheet ? getAvailableParams(sheet.stations, true) : []), [sheet]);
  const periodLabels = sheet?.periodLabels?.length ? sheet.periodLabels : MONTHS_SHORT;
  const isReadOnlyModal = modalMode === 'view' || !canEditYear;

  // Sider groups use the raw sheets list (includes empty waterbodies the dev just created)
  const siderGroups = useMemo(() => {
    const grouped = new Map();
    sheets.forEach((item) => {
      const province = WATERBODY_PROVINCE[item.key] || 'Other';
      if (!grouped.has(province)) grouped.set(province, []);
      grouped.get(province).push(item);
    });
    return [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([province, items]) => ({
        province,
        items: [...items].sort((a, b) => a.name.localeCompare(b.name)),
      }));
  }, [sheets]);

  const toggleProvinceGroup = (province) => {
    setCollapsedProvinces((current) => ({
      ...current,
      [province]: !(current[province] ?? true),
    }));
  };

  const stationRows = useMemo(() => {
    if (!sheet) return [];
    const query = search.toLowerCase().trim();
    return sheet.stations
      .filter((station) => !query || [station.stnId, station.address, station.stnNo]
        .some((value) => String(value || '').toLowerCase().includes(query)))
      .map((station) => {
        const available = params.filter((param) => getParamData(station, param));
        const latestValues = available
          .map((param) => {
            const data = getParamData(station, param);
            const monthly = normalizeMonthly(data?.monthly);
            for (let monthIndex = monthly.length - 1; monthIndex >= 0; monthIndex -= 1) {
              const latest = monthly[monthIndex];
              if (isFilledMonthValue(latest)) {
                return `${param} (${periodLabels[monthIndex] || MONTHS_SHORT[monthIndex]}): ${fmt(latest)}`;
              }
            }
            return null;
          })
          .filter(Boolean)
          .slice(0, 3);

        return {
          key: station.stnNo,
          station,
          stnNo: station.stnNo,
          stnId: station.stnId,
          address: station.address,
          parameterCount: available.length,
          latestValues,
        };
      });
  }, [params, periodLabels, search, sheet]);

  const updateSheets = (updater, successMessage, logDetails) => {
    setSheets((current) => {
      const next = updater(clone(current));
      if (isLocalYear(year)) {
        saveStoredSheetsForYear(year, next);
        if (successMessage) setMessage(successMessage);
      } else {
        // Official save to MongoDB for 2024/2025
        api.put(`/water/wqm/${year}`, { sheets: next })
          .then(() => setMessage(successMessage || `WQM ${year} saved to MongoDB.`))
          .catch((error) => setMessage(error.response?.data?.message || `Failed to save WQM ${year} to MongoDB.`));
      }
      if (logDetails) logActivity(logDetails.action, logDetails.details, user);
      return next;
    });
  };

  const openStationModal = (mode, station = null) => {
    setModalMode(mode);
    setEditingStation(station);
    setStationDraft(buildStationDraft(station, modalParams));
  };

  const closeModal = () => {
    setModalMode(null);
    setEditingStation(null);
    setStationDraft(null);
  };

  const setDraftField = (field, value) => {
    setStationDraft((draft) => ({ ...draft, [field]: value }));
  };

  const setDraftParam = (param, field, value, monthIndex = null) => {
    setStationDraft((draft) => {
      const next = clone(draft);
      if (field === 'monthly') next.params[param].monthly[monthIndex] = value;
      next.params[param].avg = computeAnnualAverage(next.params[param].monthly) ?? '';
      return next;
    });
  };

  const saveStation = () => {
    if (!sheet || !stationDraft || !canEditYear) return;
    const normalizedStation = {
      stnNo: parseEditableValue(stationDraft.stnNo),
      stnId: String(stationDraft.stnId || '').trim(),
      address: String(stationDraft.address || '').trim(),
      params: Object.fromEntries(modalParams.map((param) => {
        const paramKey = editingStation ? getParamStorageKey(editingStation, param) : param;
        const draftParam = stationDraft.params[param] || { monthly: [], avg: '' };
        return [paramKey, {
          monthly: normalizeMonthly(draftParam.monthly).map(parseEditableValue),
          avg: normalizeParamName(param) === OBSERVATION_PARAM ? null : computeAnnualAverage(draftParam.monthly),
        }];
      })),
    };

    updateSheets((draft) => draft.map((item) => {
      if (item.key !== sheet.key) return item;
      const exists = editingStation && item.stations.some((station) => station.stnNo === editingStation.stnNo);
      return {
        ...item,
        stations: exists
          ? item.stations.map((station) => (station.stnNo === editingStation.stnNo ? normalizedStation : station))
          : [...item.stations, normalizedStation],
      };
    }), editingStation
      ? (year === 2026 ? 'Station record updated.' : `Station updated and WQM ${year} saved to MongoDB.`)
      : (year === 2026 ? 'Station record added.' : `Station added and WQM ${year} saved to MongoDB.`), {
      action: editingStation ? 'Updated station record' : 'Added station record',
      details: { waterbody: sheet.name, station: normalizedStation.stnId },
    });
    toastSaved(editingStation ? 'Station record updated.' : 'Station record added.');
    closeModal();
  };

  const addStation = () => {
    if (!sheet || !canEditYear) return;
    const numericNos = sheet.stations.map((station) => Number(station.stnNo)).filter(Number.isFinite);
    const nextNo = (numericNos.length ? Math.max(...numericNos) : 0) + 1;
    openStationModal('add', {
      stnNo: nextNo,
      stnId: `New Station ${nextNo}`,
      address: '',
      params: Object.fromEntries(modalParams.map((param) => [param, { monthly: Array(12).fill(null), avg: null }])),
    });
  };

  const deleteStation = (station) => {
    if (!sheet || !canEditYear) return;
    updateSheets((draft) => draft.map((item) => (
      item.key === sheet.key
        ? { ...item, stations: item.stations.filter((entry) => entry.stnNo !== station.stnNo) }
        : item
    )), year === 2026 ? 'Station removed from local draft.' : `Station removed and WQM ${year} saved to MongoDB.`, {
      action: 'Deleted station record',
      details: { waterbody: sheet.name, station: station.stnId },
    });
  };

  const resetDrafts = () => {
    if (!canEditYear || year !== 2026) return;
    resetStoredSheetsForYear(year);
    setSheets(clone(sourceSheets));
    setActiveTab(sourceSheets[0]?.key || '');
    setSearch('');
    setMessage(`Local ${year} draft reset to source dataset.`);
    logActivity('Reset tabular draft data', { scope: `WQM ${year}` }, user);
  };

  const deleteWaterbody = () => {
    if (!sheet || !canEditYear) return;
    const next = sheets.filter((s) => s.key !== sheet.key);
    if (isLocalYear(year)) {
      saveStoredSheetsForYear(year, next);
      setMessage(`"${sheet.name}" removed from the local WQM ${year} draft.`);
    } else {
      api.put(`/water/wqm/${year}`, { sheets: next })
        .then(() => setMessage(`"${sheet.name}" removed and WQM ${year} saved to MongoDB.`))
        .catch((error) => setMessage(error.response?.data?.message || `Failed to save WQM ${year} to MongoDB.`));
    }
    setSheets(next);
    setActiveTab(next[0]?.key || '');
    setSearch('');
    logActivity('Deleted waterbody from tabular dataset', { waterbody: sheet.name, year }, user);
  };

  const openAddWaterbodyModal = () => {
    setWaterbodyDraft({ key: '', name: '', classInfo: '' });
    setWaterbodyDraftError('');
    setWaterbodyModalOpen(true);
  };

  const saveNewWaterbody = () => {
    if (!canEditYear || !waterbodyDraft?.name?.trim()) {
      setWaterbodyDraftError('Name is required.');
      return;
    }
    const derivedKey = (waterbodyDraft.key.trim() || waterbodyDraft.name.trim())
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!derivedKey) {
      setWaterbodyDraftError('Could not derive a valid key from the name. Try adding letters.');
      return;
    }
    if (sheets.some((s) => s.key === derivedKey)) {
      setWaterbodyDraftError(`A waterbody with key "${derivedKey}" already exists.`);
      return;
    }
    const newSheet = {
      key: derivedKey,
      name: waterbodyDraft.name.trim(),
      classInfo: waterbodyDraft.classInfo?.trim() || '',
      stations: [],
    };
    const next = [...sheets, newSheet];
    if (isLocalYear(year)) {
      saveStoredSheetsForYear(year, next);
      setMessage(`"${newSheet.name}" added to WQM ${year} dataset.`);
    } else {
      api.put(`/water/wqm/${year}`, { sheets: next })
        .then(() => setMessage(`"${newSheet.name}" added and WQM ${year} saved to MongoDB.`))
        .catch((error) => setMessage(error.response?.data?.message || `Failed to save WQM ${year} to MongoDB.`));
    }
    setSheets(next);
    setActiveTab(derivedKey);
    setWaterbodyModalOpen(false);
    setWaterbodyDraft(null);
    logActivity('Added new waterbody', { waterbody: newSheet.name, key: newSheet.key, year }, user);
  };

  const exportCSV = () => {
    if (!sheet) return;
    const headers = ['Stn. No.', 'Station ID', 'Address', 'Parameter', 'Unit', ...MONTHS_SHORT.map((month, index) => periodLabels[index] || month), 'Annual Avg'];
    const rows = sheet.stations.flatMap((station) => params.map((param) => {
      const data = getParamData(station, param);
      return [
        station.stnNo,
        station.stnId,
        station.address,
        param,
        getParamUnit(param),
        ...normalizeMonthly(data?.monthly).map((value) => (value !== null ? value : '')),
        fmt(computeAnnualAverage(data?.monthly) ?? data?.avg),
      ];
    }));
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `WQM${year}_${activeTab}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    logActivity('Exported tabular results CSV', { waterbody: sheet.name }, user);
  };

  const columns = [
    {
      title: 'Stn. No.',
      dataIndex: 'stnNo',
      width: 96,
      sorter: (a, b) => Number(a.stnNo) - Number(b.stnNo),
    },
    {
      title: 'Station',
      dataIndex: 'stnId',
      width: 260,
      render: (_, row) => (
        <div className="wqm-station-summary">
          <strong>{row.stnId}</strong>
          <span>{row.address}</span>
        </div>
      ),
    },
    {
      title: 'Parameters With Values',
      dataIndex: 'parameterCount',
      width: 120,
      render: (value) => <Tag color="blue">{value} parameters</Tag>,
    },
    {
      title: 'Latest Readings',
      dataIndex: 'latestValues',
      render: (values) => (
        <div className="wqm-latest-list">
          {values.length ? values.map((value) => <span key={value}>{value}</span>) : <span className="wqm-muted">No readings</span>}
        </div>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      fixed: 'right',
      render: (_, row) => (
        <Space size={6} wrap>
          <Button size="small" icon={<EyeOutlined />} title="View station details" aria-label="View station details" onClick={() => openStationModal('view', row.station)} />
          {canEditYear && (
            <>
              <Button size="small" type="primary" icon={<EditOutlined />} title="Edit station" aria-label="Edit station" onClick={() => openStationModal('edit', row.station)} />
              <Popconfirm
                title="Delete station draft?"
                description={`Remove ${row.stnId} from the encrypted local draft.`}
                okText="Delete"
                cancelText="Cancel"
                onConfirm={() => deleteStation(row.station)}
              >
                <Button danger size="small" icon={<DeleteOutlined />} title="Delete station" aria-label="Delete station" />
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ];

  const classLabel = sheet?.classInfo?.match(/CLASS\s+(\S+)/)?.[1] || '';
  const visibleMonthIndices = useMemo(() => {
    if (!stationDraft) return MONTHS_SHORT.map((_, index) => index);
    if (modalMode === 'add') return MONTHS_SHORT.map((_, index) => index);

    return MONTHS_SHORT
      .map((_, index) => index)
      .filter((monthIndex) => modalParams.some((param) => {
        const value = stationDraft.params[param]?.monthly?.[monthIndex];
        return isFilledMonthValue(value);
      }));
  }, [modalMode, modalParams, stationDraft]);

  const modalParameterColumns = [
    {
      title: 'Parameter',
      dataIndex: 'param',
      fixed: 'left',
      width: 60,
      render: (param) => (
        <div className="wqm-param-text">
          {getDisplayParamName(param)}
        </div>
      ),
    },
    ...visibleMonthIndices.map((monthIndex) => ({
      key: `month-${monthIndex}`,
      title: periodLabels[monthIndex] || MONTHS_SHORT[monthIndex],
      dataIndex: ['monthly', monthIndex],
      width: 100,
      render: (_, row) => {
        const isObservation = normalizeParamName(row.param) === OBSERVATION_PARAM;
        const value = stationDraft?.params[row.param]?.monthly?.[monthIndex] ?? '';
        return isObservation ? (
          <Input.TextArea
            className="parameter-observation-input"
            autoSize={{ minRows: 7}}
            wrap="soft"
            value={value}
            disabled={isReadOnlyModal}
            onChange={(event) => setDraftParam(row.param, 'monthly', event.target.value, monthIndex)}
          />
        ) : (
          <Input
            size="small"
            value={value}
            disabled={isReadOnlyModal}
            onChange={(event) => setDraftParam(row.param, 'monthly', event.target.value, monthIndex)}
          />
        );
      },
    })),
    {
      title: 'Annual Avg',
      dataIndex: 'avg',
      width: 96,
      render: (_, row) => (
        normalizeParamName(row.param) === OBSERVATION_PARAM
          ? <span className="wqm-muted">-</span>
          : <Input size="small" value={stationDraft?.params[row.param]?.avg ?? ''} />
      ),
    },
    {
      title: 'WQG Standard',
      dataIndex: 'param',
      key: 'wqg',
      // fixed: 'right',
      width: 80,
      render: (param) => {
        const standard = getWqgStandard(param);
        return standard ? (
          <Tag color="green" className="wqm-wqg-tag">{standard}</Tag>
        ) : (
          <span className="wqm-muted">—</span>
        );
      },
    },
  ];
  const modalParameterRows = modalParams.map((param) => ({
    key: param,
    param,
    monthly: stationDraft?.params[param]?.monthly || [],
    avg: stationDraft?.params[param]?.avg ?? '',
  }));

  return (
    <div className="wqm2026 ant-wqm2026">
      <Layout className="wqm-tabular-shell">
        <Sider className="wqm-sider" width={230}>
          <div className="wqm-sider-title">
            Waterbodies
            {canEditYear && (
              <button
                type="button"
                className="wqm-sider-add-btn"
                onClick={openAddWaterbodyModal}
                title="Add new waterbody"
                aria-label="Add new waterbody"
              >
                +
              </button>
            )}
          </div>
          <nav className="wqm-sider-menu" aria-label="Tabular result waterbodies">
            {siderGroups.map(({ province, items }) => (
              <div key={province} className="wqm-sider-province-group">
                <button
                  type="button"
                  className={`wqm-sider-province-toggle${(collapsedProvinces[province] ?? true) ? ' is-collapsed' : ''}`}
                  onClick={() => toggleProvinceGroup(province)}
                  aria-expanded={!(collapsedProvinces[province] ?? true)}
                >
                  <span className="wqm-sider-province-label">{province}</span>
                  <span className="wqm-sider-province-icon">
                    {(collapsedProvinces[province] ?? true) ? <RightOutlined /> : <DownOutlined />}
                  </span>
                </button>
                {!(collapsedProvinces[province] ?? true) && items.map((item) => (
                  <button
                    type="button"
                    key={item.key}
                    className={item.key === sheet?.key ? 'active' : ''}
                    onClick={() => { setActiveTab(item.key); setSearch(''); }}
                  >
                    <span>{item.name}</span>
                    <small>{item.stations?.length ?? 0} stations</small>
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </Sider>

        {loading && (
          <Content className="wqm-ant-panel">
            <div className="app-loading compact" role="status" aria-live="polite">
              <span />
              Loading WQM {year} tabular data...
            </div>
          </Content>
        )}

        {!loading && !sheet && (
          <Content className="wqm-ant-panel">
            <div className="wqm-ant-note">
              {message || `No WQM ${year} tabular data is available.`}
            </div>
          </Content>
        )}

        {!loading && sheet && (
        <Content className="wqm-ant-panel">
          <div className="wqm-ant-toolbar">
            <div className="wqm-ant-title-block">
              <h2>{sheet.name}</h2>
              <Space size={6} wrap>
                {classLabel && <Tag color="blue">Class {classLabel}</Tag>}
                <Tag color="green">{sheet.stations.length} stations</Tag>
                <Tag color="default">{params.length} parameters</Tag>
                {canEditYear ? <Tag color="gold">{year === 2026 ? (user?.role === 'developer' ? 'Developer CRUD' : 'Admin CRUD') : (user?.role === 'developer' ? 'Developer — MongoDB' : 'Admin — MongoDB')}</Tag> : <Tag>Read only</Tag>}
              </Space>
            </div>
            <Space>
              <Input
                allowClear
                className="wqm-ant-search"
                prefix={<SearchOutlined />}
                placeholder="Search station, address, or no."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <Button icon={<DownloadOutlined />} onClick={exportCSV}>Export CSV</Button>
              {canEditYear && (
                <>
                  <Button type="primary" icon={<PlusOutlined />} onClick={addStation}>Add Station</Button>
                  {year === 2026 && (
                    <Popconfirm
                      title="Reset local draft?"
                      description={`This restores the original WQM ${year} source data.`}
                      okText="Reset"
                      cancelText="Cancel"
                      onConfirm={resetDrafts}
                    >
                      <Button icon={<ReloadOutlined />}>Reset Draft</Button>
                    </Popconfirm>
                  )}
                  <Popconfirm
                    title={`Delete "${sheet?.name}"?`}
                    description={year === 2026 ? 'This removes the waterbody from the local draft.' : `This removes the waterbody and saves WQM ${year} to MongoDB.`}
                    okText="Yes, delete"
                    okButtonProps={{ danger: true }}
                    cancelText="Cancel"
                    onConfirm={deleteWaterbody}
                    disabled={!sheet}
                  >
                    <Button danger disabled={!sheet} icon={<DeleteOutlined />}>Delete Waterbody</Button>
                  </Popconfirm>
                  {isCustomTabularYear(year) && (
                    <Popconfirm
                      title={`Delete monitoring year ${year}?`}
                      description="This permanently removes the entire monitoring-year template and all its encoded data."
                      okText="Delete year"
                      okButtonProps={{ danger: true }}
                      cancelText="Cancel"
                      onConfirm={() => {
                        removeTabularYear(year);
                        logActivity('Deleted monitoring year', { year }, user);
                        toastSaved(`Monitoring year ${year} deleted.`);
                        onYearDeleted?.(year);
                      }}
                    >
                      <Button danger icon={<DeleteOutlined />}>Delete Year {year}</Button>
                    </Popconfirm>
                  )}
                </>
              )}
            </Space>
          </div>

          {(message || !canManageData) && (
            <div className="wqm-ant-note">
              {message || (year === 2026
                ? 'Read-only mode. CRUD controls are restricted to administrators and developers.'
                : 'Read-only mode. Only administrators and developers can edit this dataset.')}
            </div>
          )}

          <Table
            className="wqm-ant-table wqm-stations-table"
            size="small"
            rowKey="key"
            columns={columns}
            dataSource={stationRows}
            scroll={{ x: 1040, y: 'calc(100vh - 350px)' }}
            pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 25, 50, 100] }}
          />
        </Content>
        )}
      </Layout>

      <Modal
        title={modalMode === 'add' ? 'Add Station' : modalMode === 'edit' ? 'Edit Station' : 'Station Details'}
        open={Boolean(modalMode)}
        onCancel={closeModal}
        width="min(1500px, 96vw)"
        rootClassName="wqm-station-modal-root"
        className="wqm-station-modal"
        destroyOnHidden
        footer={[
          <Button key="cancel" onClick={closeModal}>{isReadOnlyModal ? 'Close' : 'Cancel'}</Button>,
          !isReadOnlyModal && <Button key="save" type="primary" onClick={saveStation}>Save Station</Button>,
        ].filter(Boolean)}
      >
        {stationDraft && (
          <div className="station-modal-body">
            <div className="station-modal-grid">
              <label>
                <span>Station No.</span>
                <Input value={stationDraft.stnNo} disabled={isReadOnlyModal} onChange={(event) => setDraftField('stnNo', event.target.value)} />
              </label>
              <label>
                <span>Station ID</span>
                <Input value={stationDraft.stnId} disabled={isReadOnlyModal} onChange={(event) => setDraftField('stnId', event.target.value)} />
              </label>
              <label className="station-address-field">
                <span>Address</span>
                <Input value={stationDraft.address} disabled={isReadOnlyModal} onChange={(event) => setDraftField('address', event.target.value)} />
              </label>
            </div>

            <Table
              className="parameter-editor-ant-table"
              size="small"
              rowKey="key"
              columns={modalParameterColumns}
              dataSource={modalParameterRows}
              pagination={false}
              scroll={{ x: 1640, y: '58vh' }}
            />
          </div>
        )}
      </Modal>

      {/* ── Add Waterbody Modal ── */}
      <Modal
        title="Add New Waterbody"
        open={waterbodyModalOpen}
        onCancel={() => { setWaterbodyModalOpen(false); setWaterbodyDraft(null); setWaterbodyDraftError(''); }}
        onOk={saveNewWaterbody}
        okText="Add Waterbody"
        okButtonProps={{ type: 'primary', disabled: !waterbodyDraft?.name?.trim() }}
        width={700}
        destroyOnHidden
      >
        {waterbodyDraft && (
          <div className="station-modal-grid waterbody-modal-grid" style={{ marginTop: '0.75rem' }}>
            <label>
              <span>Waterbody Name <span style={{ color: '#ef4444' }}>*</span></span>
              <Input
                autoFocus
                value={waterbodyDraft.name}
                placeholder="e.g. Pasig River"
                onChange={(event) => {
                  const name = event.target.value;
                  const derivedKey = name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
                  setWaterbodyDraft((d) => ({ ...d, name, key: derivedKey }));
                  setWaterbodyDraftError('');
                }}
              />
            </label>
            <label>
              <span>Key (auto-generated, editable)</span>
              <Input
                value={waterbodyDraft.key}
                placeholder="e.g. PASIG_RIVER"
                onChange={(event) => {
                  setWaterbodyDraft((d) => ({ ...d, key: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') }));
                  setWaterbodyDraftError('');
                }}
              />
            </label>
            <label className="station-address-field">
              <span>Class Info (optional)</span>
              <Input
                value={waterbodyDraft.classInfo}
                placeholder="e.g. CLASS C (3 STATIONS)"
                onChange={(event) => setWaterbodyDraft((d) => ({ ...d, classInfo: event.target.value }))}
              />
            </label>
            {waterbodyDraftError && (
              <p style={{ color: '#ef4444', fontSize: '0.8rem', margin: 0 }}>{waterbodyDraftError}</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default WQM2026;

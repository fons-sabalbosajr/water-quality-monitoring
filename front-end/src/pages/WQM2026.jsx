import { useEffect, useMemo, useState } from 'react';
import { Button, Input, Layout, Modal, Popconfirm, Space, Table, Tag } from 'antd';
import {
  DeleteOutlined, DownloadOutlined, EditOutlined, EyeOutlined, PlusOutlined,
  ReloadOutlined, SearchOutlined,
} from '@ant-design/icons';
import 'antd/dist/reset.css';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';
import { logActivity } from '../utils/appLog';
import encryptedStorage from '../utils/encryptedStorage';
import {
  MONTHS_SHORT, fmt, getAvailableParams, getParamData,
  getParamUnit, normalizeParamName, OBSERVATION_PARAM, toNumber,
} from '../utils/wqmData';
import {
  INITIAL_SHEETS, getStoredWqmSheets, resetStoredWqmSheets,
  saveStoredWqmSheets,
} from '../utils/wqmSheets';
import './WQM2026.css';

const { Sider, Content } = Layout;

const clone = (value) => JSON.parse(JSON.stringify(value));
const normalizeMonthly = (monthly = []) => Array.from({ length: 12 }, (_, index) => monthly[index] ?? null);
const getYearDraftKey = (year) => `wqm_${year}_drafts`;

const getStoredSheetsForYear = (year, fallback = INITIAL_SHEETS) => (
  year === 2026
    ? getStoredWqmSheets()
    : (encryptedStorage.getItem(getYearDraftKey(year)) || clone(fallback))
);

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

const WQM2026 = ({ year = 2026 }) => {
  const { user } = useAuth();
  const canManageData = ['admin', 'developer'].includes(user?.role);
  const canEditYear = year === 2026 ? canManageData : user?.role === 'admin';
  const hasStoredSheetsForYear = (year) => Boolean(encryptedStorage.getItem(getYearDraftKey(year)));
  const [sheets, setSheets] = useState(() => (year === 2026 ? getStoredSheetsForYear(year) : []));
  const [sourceSheets, setSourceSheets] = useState(() => (year === 2026 ? clone(INITIAL_SHEETS) : []));
  const [loading, setLoading] = useState(year !== 2026);
  const [activeTab, setActiveTab] = useState('');
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [modalMode, setModalMode] = useState(null);
  const [editingStation, setEditingStation] = useState(null);
  const [stationDraft, setStationDraft] = useState(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setSearch('');
        setMessage('');
      }
    });
    const hasDraft = hasStoredSheetsForYear(year);

    if (year === 2026) {
      const localSheets = getStoredSheetsForYear(year, INITIAL_SHEETS);
      queueMicrotask(() => {
        if (!cancelled) {
          setMessage(hasDraft ? `WQM ${year} loaded from encrypted local draft.` : `WQM ${year} loaded from the bundled source dataset.`);
          setLoading(false);
          setSourceSheets(clone(INITIAL_SHEETS));
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
            const latest = [...monthly].reverse().find((value) => value !== null && value !== undefined && value !== '');
            return latest !== undefined ? `${param}: ${fmt(latest)}` : null;
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
  }, [params, search, sheet]);

  const updateSheets = (updater, successMessage, logDetails) => {
    setSheets((current) => {
      const next = updater(clone(current));
      saveStoredSheetsForYear(year, next);
      return next;
    });
    if (successMessage) setMessage(successMessage);
    if (logDetails) logActivity(logDetails.action, logDetails.details, user);
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
    }), editingStation ? 'Station record updated.' : 'Station record added.', {
      action: editingStation ? 'Updated station record' : 'Added station record',
      details: { waterbody: sheet.name, station: normalizedStation.stnId },
    });
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
    )), 'Station removed from encrypted local draft.', {
      action: 'Deleted station record',
      details: { waterbody: sheet.name, station: station.stnId },
    });
  };

  const resetDrafts = () => {
    if (!canEditYear) return;
    resetStoredSheetsForYear(year);
    setSheets(clone(sourceSheets));
    setActiveTab(sourceSheets[0]?.key || '');
    setSearch('');
    setMessage(`Encrypted local ${year} draft reset to source dataset.`);
    logActivity('Reset tabular draft data', { scope: `WQM ${year}` }, user);
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
      width: 170,
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
  const modalParameterColumns = [
    {
      title: 'Parameter',
      dataIndex: 'param',
      fixed: 'left',
      width: 170,
      render: (param) => (
        <div className="wqm-param-text">
          <strong>{getDisplayParamName(param)}</strong>
        </div>
      ),
    },
    {
      title: 'Unit',
      dataIndex: 'param',
      width: 80,
      render: (param) => (
        <span className="parameter-unit-cell">
          {normalizeParamName(param) === OBSERVATION_PARAM ? 'text' : (getParamUnit(param) || 'index')}
        </span>
      ),
    },
    ...MONTHS_SHORT.map((month, monthIndex) => ({
      title: periodLabels[monthIndex] || month,
      dataIndex: ['monthly', monthIndex],
      width: 96,
      render: (_, row) => {
        const isObservation = normalizeParamName(row.param) === OBSERVATION_PARAM;
        const value = stationDraft?.params[row.param]?.monthly?.[monthIndex] ?? '';
        return isObservation ? (
          <Input.TextArea
            className="parameter-observation-input"
            autoSize={{ minRows: 2, maxRows: 5 }}
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
          : <Input size="small" value={stationDraft?.params[row.param]?.avg ?? ''} disabled />
      ),
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
          <div className="wqm-sider-title">Waterbodies</div>
          <nav className="wqm-sider-menu" aria-label="Tabular result waterbodies">
            {sheets.map((item) => (
              <button
                type="button"
                key={item.key}
                className={item.key === sheet?.key ? 'active' : ''}
                onClick={() => { setActiveTab(item.key); setSearch(''); }}
              >
                <span>{item.name}</span>
                <small>{item.stations.length} stations</small>
              </button>
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
                {canEditYear ? <Tag color="gold">{year === 2026 ? (user?.role === 'developer' ? 'Developer CRUD' : 'Admin CRUD') : 'Admin Draft Editing'}</Tag> : <Tag>Read only</Tag>}
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
                  <Popconfirm
                    title="Reset encrypted local draft?"
                    description={`This restores the original WQM ${year} source data.`}
                    okText="Reset"
                    cancelText="Cancel"
                    onConfirm={resetDrafts}
                  >
                    <Button icon={<ReloadOutlined />}>Reset Draft</Button>
                  </Popconfirm>
                </>
              )}
            </Space>
          </div>

          {(message || !canManageData) && (
            <div className="wqm-ant-note">
              {message || (year === 2026
                ? 'Read-only mode. CRUD controls are restricted to administrators and developers.'
                : 'Read-only mode. Only administrators can edit WQM 2024 and WQM 2025 local drafts.')}
            </div>
          )}

          <Table
            className="wqm-ant-table wqm-stations-table"
            size="small"
            rowKey="key"
            columns={columns}
            dataSource={stationRows}
            scroll={{ x: 1040, y: 'calc(100vh - 350px)' }}
            pagination={{ pageSize: 14, showSizeChanger: true, pageSizeOptions: [10, 14, 25, 50] }}
          />
        </Content>
        )}
      </Layout>

      <Modal
        title={modalMode === 'add' ? 'Add Station' : modalMode === 'edit' ? 'Edit Station' : 'Station Details'}
        open={Boolean(modalMode)}
        onCancel={closeModal}
        width="min(1600px, 96vw)"
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
              scroll={{ x: 1320, y: '58vh' }}
            />
          </div>
        )}
      </Modal>
    </div>
  );
};

export default WQM2026;

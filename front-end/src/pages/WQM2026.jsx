import { useMemo, useState } from 'react';
import { Button, Input, Popconfirm, Space, Table, Tabs, Tag } from 'antd';
import {
  DeleteOutlined, DownloadOutlined, PlusOutlined, ReloadOutlined, SearchOutlined,
} from '@ant-design/icons';
import 'antd/dist/reset.css';
import wqmData from '../data/wqm2026.json';
import { useAuth } from '../context/AuthContext';
import encryptedStorage from '../utils/encryptedStorage';
import {
  MONTHS_SHORT, fmt, getAvailableParams, getParamData, getStations,
  hasNumericReading, normalizeParamName, toTitle,
} from '../utils/wqmData';
import './WQM2026.css';

const STORAGE_KEY = 'wqm_2026_drafts';

const clone = (value) => JSON.parse(JSON.stringify(value));

const buildSheets = (source) => Object.entries(source)
  .map(([key, val]) => ({
    key,
    name: val.name ? toTitle(val.name) : toTitle(key),
    classInfo: val.classInfo || '',
    stations: getStations(val),
  }))
  .filter((sheet) => sheet.stations.some(hasNumericReading));

const filterSheetsWithReadings = (sheets) => sheets.filter((sheet) => (
  sheet.stations?.some(hasNumericReading)
));

const INITIAL_SHEETS = buildSheets(wqmData);

const parseEditableValue = (value) => {
  const cleaned = String(value ?? '').trim();
  if (!cleaned || cleaned === '-' || cleaned === '—') return null;
  if (cleaned === '*') return '*';
  if (/^</.test(cleaned)) return cleaned;
  const numeric = Number(cleaned.replace(/,/g, ''));
  return Number.isFinite(numeric) ? numeric : cleaned;
};

const normalizeMonthly = (monthly = []) => Array.from({ length: 12 }, (_, index) => monthly[index] ?? null);

const getParamStorageKey = (station, displayParam) => (
  Object.keys(station.params || {}).find((key) => normalizeParamName(key) === normalizeParamName(displayParam)) || displayParam
);

const EditableCell = ({ value, className = '', disabled, onSave, ariaLabel }) => {
  if (disabled) return <span className={className}>{fmt(value)}</span>;
  return (
    <Input
      size="small"
      className={`wqm-ant-input ${className}`}
      defaultValue={value ?? ''}
      aria-label={ariaLabel}
      onBlur={(event) => onSave(event.target.value)}
      onPressEnter={(event) => event.currentTarget.blur()}
    />
  );
};

const WQM2026 = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [sheets, setSheets] = useState(() => filterSheetsWithReadings(encryptedStorage.getItem(STORAGE_KEY) || INITIAL_SHEETS));
  const [activeTab, setActiveTab] = useState(sheets[0]?.key || '');
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');

  const sheet = sheets.find((item) => item.key === activeTab) || sheets[0];

  const updateSheets = (updater, successMessage) => {
    setSheets((current) => {
      const next = updater(clone(current));
      encryptedStorage.setItem(STORAGE_KEY, next);
      return next;
    });
    if (successMessage) setMessage(successMessage);
  };

  const params = useMemo(() => (sheet ? getAvailableParams(sheet.stations, false) : []), [sheet]);

  const stationOptions = useMemo(() => (sheet?.stations || []).map((station) => ({
    text: station.stnId,
    value: station.stnId,
  })), [sheet]);

  const paramOptions = useMemo(() => params.map((param) => ({ text: param, value: param })), [params]);

  const tableRows = useMemo(() => {
    if (!sheet) return [];
    const query = search.toLowerCase().trim();
    return sheet.stations
      .filter((station) => !query || [station.stnId, station.address, station.stnNo]
        .some((value) => String(value || '').toLowerCase().includes(query)))
      .flatMap((station) => params.map((param) => {
        const data = getParamData(station, param);
        return {
          key: `${station.stnNo}-${param}`,
          station,
          stationNo: station.stnNo,
          stationId: station.stnId,
          address: station.address,
          param,
          monthly: normalizeMonthly(data?.monthly),
          avg: data?.avg ?? null,
        };
      }));
  }, [params, search, sheet]);

  const updateStation = (stationNo, updater, successMessage) => {
    if (!sheet || !isAdmin) return;
    updateSheets((draft) => draft.map((item) => {
      if (item.key !== sheet.key) return item;
      return {
        ...item,
        stations: item.stations.map((station) => (
          station.stnNo === stationNo ? updater(station) : station
        )),
      };
    }), successMessage);
  };

  const updateReading = (station, param, monthIndex, value) => {
    updateStation(station.stnNo, (draftStation) => {
      const paramKey = getParamStorageKey(draftStation, param);
      const existing = getParamData(draftStation, param) || { monthly: Array(12).fill(null), avg: null };
      const normalizedMonthly = normalizeMonthly(existing.monthly);
      normalizedMonthly[monthIndex] = parseEditableValue(value);
      draftStation.params[paramKey] = { ...existing, monthly: normalizedMonthly };
      return draftStation;
    }, 'Monthly reading saved in encrypted local draft.');
  };

  const updateAverage = (station, param, value) => {
    updateStation(station.stnNo, (draftStation) => {
      const paramKey = getParamStorageKey(draftStation, param);
      const existing = getParamData(draftStation, param) || { monthly: Array(12).fill(null), avg: null };
      draftStation.params[paramKey] = { ...existing, monthly: normalizeMonthly(existing.monthly), avg: parseEditableValue(value) };
      return draftStation;
    }, 'Annual average saved in encrypted local draft.');
  };

  const updateStationField = (station, field, value) => {
    updateStation(station.stnNo, (draftStation) => ({
      ...draftStation,
      [field]: field === 'stnNo' ? parseEditableValue(value) : String(value || '').trim(),
    }), 'Station details saved in encrypted local draft.');
  };

  const addStation = () => {
    if (!sheet || !isAdmin) return;
    const numericNos = sheet.stations.map((station) => Number(station.stnNo)).filter(Number.isFinite);
    const nextNo = (numericNos.length ? Math.max(...numericNos) : 0) + 1;
    const paramsTemplate = Object.fromEntries(params.map((param) => [param, { monthly: Array(12).fill(null), avg: null }]));
    updateSheets((draft) => draft.map((item) => (
      item.key === sheet.key
        ? {
          ...item,
          stations: [
            ...item.stations,
            { stnNo: nextNo, stnId: `New Station ${nextNo}`, address: 'Update station address', params: paramsTemplate },
          ],
        }
        : item
    )), 'New station added to encrypted local draft.');
  };

  const deleteStation = (station) => {
    if (!sheet || !isAdmin) return;
    updateSheets((draft) => draft.map((item) => (
      item.key === sheet.key
        ? { ...item, stations: item.stations.filter((entry) => entry.stnNo !== station.stnNo) }
        : item
    )), 'Station removed from encrypted local draft.');
  };

  const resetDrafts = () => {
    if (!isAdmin) return;
    encryptedStorage.removeItem(STORAGE_KEY);
    setSheets(INITIAL_SHEETS);
    setActiveTab(INITIAL_SHEETS[0]?.key || '');
    setSearch('');
    setMessage('Encrypted local draft reset to source dataset.');
  };

  const exportCSV = () => {
    if (!sheet) return;
    const headers = ['Stn. No.', 'Station ID', 'Address', 'Parameter', ...MONTHS_SHORT, 'Annual Avg'];
    const rows = tableRows.map((row) => [
      row.stationNo, row.stationId, row.address, row.param,
      ...row.monthly.map((value) => (value !== null ? value : '')),
      row.avg !== null ? row.avg : '',
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `WQM2026_${activeTab}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const columns = [
    {
      title: 'No.',
      dataIndex: 'stationNo',
      width: 72,
      fixed: 'left',
      render: (_, row) => (
        <EditableCell
          value={row.stationNo}
          disabled={!isAdmin}
          className="center"
          ariaLabel={`${row.stationId} station number`}
          onSave={(value) => updateStationField(row.station, 'stnNo', value)}
        />
      ),
    },
    {
      title: 'Station / Address',
      dataIndex: 'stationId',
      width: 270,
      fixed: 'left',
      filters: stationOptions,
      filterSearch: true,
      onFilter: (value, row) => row.stationId === value,
      render: (_, row) => (
        <div className="wqm-station-editor">
          {isAdmin ? (
            <>
              <Input
                size="small"
                className="wqm-ant-input station-name"
                defaultValue={row.stationId}
                onBlur={(event) => updateStationField(row.station, 'stnId', event.target.value)}
                onPressEnter={(event) => event.currentTarget.blur()}
              />
              <Input
                size="small"
                className="wqm-ant-input station-address"
                defaultValue={row.address}
                onBlur={(event) => updateStationField(row.station, 'address', event.target.value)}
                onPressEnter={(event) => event.currentTarget.blur()}
              />
            </>
          ) : (
            <>
              <strong>{row.stationId}</strong>
              <span>{row.address}</span>
            </>
          )}
        </div>
      ),
    },
    {
      title: 'Parameter',
      dataIndex: 'param',
      width: 190,
      fixed: 'left',
      filters: paramOptions,
      filterSearch: true,
      onFilter: (value, row) => row.param === value,
      render: (value) => <span className="wqm-param-text">{value}</span>,
    },
    ...MONTHS_SHORT.map((month, monthIndex) => ({
      title: month,
      dataIndex: ['monthly', monthIndex],
      width: 86,
      align: 'right',
      render: (_, row) => (
        <EditableCell
          value={row.monthly[monthIndex]}
          disabled={!isAdmin}
          className="numeric"
          ariaLabel={`${row.stationId} ${row.param} ${month}`}
          onSave={(value) => updateReading(row.station, row.param, monthIndex, value)}
        />
      ),
    })),
    {
      title: 'Annual Avg',
      dataIndex: 'avg',
      width: 112,
      align: 'right',
      className: 'annual-average-column',
      render: (_, row) => (
        <EditableCell
          value={row.avg}
          disabled={!isAdmin}
          className="numeric avg"
          ariaLabel={`${row.stationId} ${row.param} annual average`}
          onSave={(value) => updateAverage(row.station, row.param, value)}
        />
      ),
    },
  ];

  if (isAdmin) {
    columns.push({
      title: 'Actions',
      key: 'actions',
      width: 110,
      fixed: 'right',
      render: (_, row) => (
        <Popconfirm
          title="Delete station draft?"
          description={`Remove ${row.stationId} from the encrypted local draft.`}
          okText="Delete"
          cancelText="Cancel"
          onConfirm={() => deleteStation(row.station)}
        >
          <Button danger size="small" icon={<DeleteOutlined />}>Delete</Button>
        </Popconfirm>
      ),
    });
  }

  const tabItems = sheets.map((item) => ({ key: item.key, label: item.name }));
  const classLabel = sheet?.classInfo?.match(/CLASS\s+(\S+)/)?.[1] || '';

  return (
    <div className="wqm2026 ant-wqm2026">
      <Tabs
        className="wqm-ant-tabs"
        activeKey={sheet?.key}
        items={tabItems}
        onChange={(key) => { setActiveTab(key); setSearch(''); }}
      />

      {sheet && (
        <section className="wqm-ant-panel">
          <div className="wqm-ant-toolbar">
            <div className="wqm-ant-title-block">
              <h2>{sheet.name}</h2>
              <Space size={6} wrap>
                {classLabel && <Tag color="blue">Class {classLabel}</Tag>}
                <Tag color="green">{sheet.stations.length} stations</Tag>
                <Tag color="default">{params.length} parameters</Tag>
                {isAdmin ? <Tag color="gold">Admin CRUD</Tag> : <Tag>Read only</Tag>}
              </Space>
            </div>
            <Space wrap>
              <Input
                allowClear
                className="wqm-ant-search"
                prefix={<SearchOutlined />}
                placeholder="Search station, address, or no."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <Button icon={<DownloadOutlined />} onClick={exportCSV}>Export CSV</Button>
              {isAdmin && (
                <>
                  <Button type="primary" icon={<PlusOutlined />} onClick={addStation}>Add Station</Button>
                  <Popconfirm
                    title="Reset encrypted local draft?"
                    description="This restores the bundled 2026 source data."
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

          {(message || !isAdmin) && (
            <div className="wqm-ant-note">
              {message || 'Read-only mode. CRUD controls are restricted to administrators.'}
            </div>
          )}

          <Table
            className="wqm-ant-table"
            size="small"
            bordered
            sticky
            rowKey="key"
            columns={columns}
            dataSource={tableRows}
            scroll={{ x: 1680, y: 'calc(100vh - 360px)' }}
            pagination={{ pageSize: 80, showSizeChanger: true, pageSizeOptions: [40, 80, 120, 200] }}
          />
        </section>
      )}
    </div>
  );
};

export default WQM2026;

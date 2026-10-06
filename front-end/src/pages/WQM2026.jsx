import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
dayjs.extend(customParseFormat);
import { Button, DatePicker, Input, Layout, Modal, Popconfirm, Space, Table, Tag } from 'antd';
import {
  DownOutlined,
  DeleteOutlined, DownloadOutlined, EditOutlined, EyeOutlined, PlusOutlined,
  ReloadOutlined, SearchOutlined,
  RightOutlined,
} from '@ant-design/icons';
import 'antd/dist/reset.css';
import { useAuth } from '../context/authStore';
import { logActivity } from '../utils/appLog';
import { toastSaved } from '../utils/swal';
import encryptedStorage from '../utils/encryptedStorage';
import { useTablePagination } from '../utils/tablePagination';
import {
  applyDraftParamValue, applyDraftSamplingDate, buildStationDraft,
  computeAnnualAverage, normalizeMonthly, parseEditableValue,
} from '../utils/stationDraft';
import {
  MONTHS_SHORT, PARAM_LIMITS, fmt, getAvailableParams, getParamData,
  getParamUnit, normalizeParamName, OBSERVATION_PARAM,
} from '../utils/wqmData';
import {
  WATERBODY_PROVINCE, WQM_DRAFTS_EVENT, getStoredWqmSheets, saveYearSheetsLocal,
  isCustomTabularYear, removeTabularYear,
  revalidateYear, refetchYearFromServer, saveYearToServer,
} from '../utils/wqmSheets';
import './WQM2026.css';

const { Sider, Content } = Layout;

const clone = (value) => JSON.parse(JSON.stringify(value));
const getYearDraftKey = (year) => `wqm_${year}_drafts`;

// Sentinel "parameter" used to render the Date of Sampling row inside the
// station parameter editor table.
const DATE_ROW_KEY = '__date_of_sampling__';

// Admin-created custom years (2027+) live only in encrypted local storage.
// 2024–2026 are stored in MongoDB; this browser keeps a synced local copy so
// the table renders instantly and every save is sent to the server. (2026 used
// to be local-only, so edits never reached the public dashboard.)
const isLocalYear = (year) => isCustomTabularYear(year);

const getStoredSheetsForYear = (year) => {
  if (year === 2026) return getStoredWqmSheets();
  return encryptedStorage.getItem(getYearDraftKey(year)) || [];
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

const WQM2026 = ({ year = 2026, onYearDeleted }) => {
  const { user } = useAuth();
  const canManageData = ['admin', 'developer'].includes(user?.role);
  const canEditYear = canManageData;
  const [sheets, setSheets] = useState(() => getStoredSheetsForYear(year));
  const [loading, setLoading] = useState(() => !getStoredSheetsForYear(year).length);
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
  const [saving, setSaving] = useState(false);
  // Typing in the search box re-filtered and re-rendered the whole table on
  // every keystroke; the table only reads the debounced value.
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Mirror of `sheets` so updateSheets() can read the latest value without
  // depending on the state variable captured in a stale closure.
  const sheetsRef = useRef(sheets);
  useEffect(() => { sheetsRef.current = sheets; }, [sheets]);

  const { pagination: tablePagination, onTotalChange } = useTablePagination('wqm-stations');

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 200);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setSearch('');
        setMessage('');
      }
    });
    const applySheets = (next, nextMessage) => {
      sheetsRef.current = next;
      setSheets(next);
      // Keep the open waterbody when a background sync replaces the data.
      setActiveTab((current) => (next.some((item) => item.key === current) ? current : (next[0]?.key || '')));
      setMessage(nextMessage);
      setLoading(false);
    };

    if (isLocalYear(year)) {
      queueMicrotask(() => {
        if (!cancelled) applySheets(getStoredSheetsForYear(year), `Monitoring year ${year} loaded from encrypted local draft.`);
      });
      return () => { cancelled = true; };
    }

    // Stored years: show this browser's copy at once, then sync with MongoDB.
    const cached = getStoredSheetsForYear(year);
    queueMicrotask(() => {
      if (cancelled) return;
      if (cached.length) {
        applySheets(cached, `Checking MongoDB for WQM ${year} updates…`);
      } else {
        setLoading(true);
        setSheets([]);
        setActiveTab('');
      }
    });
    revalidateYear(year, { force: true }).then((status) => {
      if (cancelled) return;
      applySheets(
        getStoredSheetsForYear(year),
        status === 'offline'
          ? `MongoDB is unreachable — showing the copy of WQM ${year} saved in this browser.`
          : `WQM ${year} loaded from MongoDB.`,
      );
    });

    return () => { cancelled = true; };
  }, [year]);

  // A focus/background sync elsewhere can replace this year's local copy.
  // Re-read it so the next save is not computed from (and does not overwrite
  // the server with) stale data. Only server syncs carry `detail.year`.
  useEffect(() => {
    if (isLocalYear(year)) return undefined;
    const onSynced = (event) => {
      if (event.detail?.year !== year) return;
      const next = getStoredSheetsForYear(year);
      sheetsRef.current = next;
      setSheets(next);
    };
    window.addEventListener(WQM_DRAFTS_EVENT, onSynced);
    return () => window.removeEventListener(WQM_DRAFTS_EVENT, onSynced);
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
    const query = debouncedSearch.toLowerCase().trim();
    return sheet.stations
      .filter((station) => !query || [station.stnId, station.address, station.stnNo]
        .some((value) => String(value || '').toLowerCase().includes(query)))
      .map((station, stationIndex) => {
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
          // stnNo is user-editable and not guaranteed unique. Duplicates made
          // React reuse the wrong row, so edits appeared on the wrong station
          // and sorting produced unstable output. Fall back to the index.
          key: `${sheet.key}:${station.stnNo ?? 'n'}:${stationIndex}`,
          station,
          stnNo: station.stnNo,
          stnId: station.stnId,
          address: station.address,
          parameterCount: available.length,
          latestValues,
        };
      });
  }, [params, periodLabels, debouncedSearch, sheet]);

  // Searching or deleting can shrink the result set below the current page.
  useEffect(() => { onTotalChange(stationRows.length); }, [stationRows.length, onTotalChange]);

  // Persist a new sheet set: local encrypted copy always, MongoDB for every
  // stored year (2024–2026). Kept separate from setState so it is only ever
  // run once per user action.
  const persistSheets = useCallback((next, successMessage) => {
    // Cache locally AND broadcast the draft event so every page in this
    // browser (Dashboard, Visualizations, Waterbody Profiles) updates at once.
    saveYearSheetsLocal(year, next);
    if (successMessage) setMessage(successMessage);
    // MongoDB is what other devices and the public dashboard read.
    if (!isLocalYear(year)) {
      setSaving(true);
      saveYearToServer(year, next)
        .then(() => setMessage(successMessage || `WQM ${year} saved to MongoDB.`))
        .catch((error) => setMessage(
          error.response?.data?.message
            || `Failed to save WQM ${year} to MongoDB. The change is kept in this browser — save again to retry.`,
        ))
        .finally(() => setSaving(false));
    }
  }, [year]);

  const savedNote = isLocalYear(year) ? '' : ` and WQM ${year} saved to MongoDB`;

  /**
   * React may invoke a state updater more than once (StrictMode does so
   * deliberately in development). The previous version ran the local save, the
   * MongoDB PUT and the activity log *inside* the updater, so every edit fired
   * two network writes and wrote two log entries. Compute the next value from
   * the current sheets, then commit state and side effects separately.
   */
  const updateSheets = useCallback((updater, successMessage, logDetails) => {
    const next = updater(clone(sheetsRef.current));
    sheetsRef.current = next;
    setSheets(next);
    persistSheets(next, successMessage);
    if (logDetails) logActivity(logDetails.action, logDetails.details, user);
  }, [persistSheets, user]);

  const openStationModal = useCallback((mode, station = null) => {
    setModalMode(mode);
    setEditingStation(station);
    // Must read the *current* modalParams. When this closed over a stale empty
    // list, the draft was built with no params while the modal still rendered
    // rows for every real parameter — and the first keystroke crashed.
    setStationDraft(buildStationDraft(station, modalParams, sheet?.classInfo || ''));
  }, [modalParams, sheet]);

  const closeModal = () => {
    setModalMode(null);
    setEditingStation(null);
    setStationDraft(null);
  };

  const setDraftField = (field, value) => {
    setStationDraft((draft) => ({ ...draft, [field]: value }));
  };

  const setDraftParam = (param, field, value, monthIndex = null) => {
    if (field !== 'monthly') return;
    setStationDraft((draft) => applyDraftParamValue(draft, param, value, monthIndex));
  };

  const setDraftSamplingDate = (monthIndex, value) => {
    setStationDraft((draft) => applyDraftSamplingDate(draft, monthIndex, value));
  };

  const saveStation = () => {
    if (!sheet || !stationDraft || !canEditYear) return;
    const normalizedStation = {
      stnNo: parseEditableValue(stationDraft.stnNo),
      stnId: String(stationDraft.stnId || '').trim(),
      address: String(stationDraft.address || '').trim(),
      classInfo: String(stationDraft.classInfo || '').trim(),
      samplingDates: normalizeMonthly(stationDraft.samplingDates)
        .map((value) => (String(value ?? '').trim() || null)),
      params: Object.fromEntries(modalParams.map((param) => {
        const paramKey = editingStation ? getParamStorageKey(editingStation, param) : param;
        const draftParam = stationDraft.params?.[param] || { monthly: [], avg: '' };
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
    }), `Station ${editingStation ? 'updated' : 'added'}${savedNote}.`, {
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

  const deleteStation = useCallback((station) => {
    if (!sheet || !canEditYear) return;
    updateSheets((draft) => draft.map((item) => (
      item.key === sheet.key
        ? { ...item, stations: item.stations.filter((entry) => entry.stnNo !== station.stnNo) }
        : item
    )), `Station removed${savedNote}.`, {
      action: 'Deleted station record',
      details: { waterbody: sheet.name, station: station.stnId },
    });
  }, [sheet, canEditYear, updateSheets, savedNote]);

  // Discard this browser's unsaved changes and reload the MongoDB copy.
  const reloadFromServer = () => {
    if (!canEditYear || isLocalYear(year)) return;
    setSaving(true);
    refetchYearFromServer(year)
      .then((fresh) => {
        sheetsRef.current = fresh;
        setSheets(fresh);
        setActiveTab((current) => (fresh.some((item) => item.key === current) ? current : (fresh[0]?.key || '')));
        setSearch('');
        setMessage(`WQM ${year} reloaded from MongoDB.`);
        logActivity('Reloaded tabular data from server', { scope: `WQM ${year}` }, user);
      })
      .catch((error) => setMessage(error.response?.data?.message || error.message || `Unable to reload WQM ${year}.`))
      .finally(() => setSaving(false));
  };

  const deleteWaterbody = () => {
    if (!sheet || !canEditYear) return;
    const next = sheets.filter((s) => s.key !== sheet.key);
    sheetsRef.current = next;
    persistSheets(next, `"${sheet.name}" removed${savedNote}.`);
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
    sheetsRef.current = next;
    persistSheets(next, `"${newSheet.name}" added${savedNote}.`);
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

  // Memoised so antd's Table does not treat its column set as changed on every
  // render. The dependencies must include the handlers the cells call: an
  // earlier version pinned this to [canEditYear] alone, which froze the row
  // buttons on their first-render closures and made "Edit" build a station
  // draft from an empty parameter list.
  const columns = useMemo(() => [
    {
      title: 'Stn. No.',
      dataIndex: 'stnNo',
      width: 84,
      align: 'center',
      // Non-numeric station numbers produced NaN, which sorts unpredictably.
      sorter: (a, b) => {
        const left = Number(a.stnNo);
        const right = Number(b.stnNo);
        if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
        return String(a.stnNo ?? '').localeCompare(String(b.stnNo ?? ''), undefined, { numeric: true });
      },
    },
    {
      title: 'Station',
      dataIndex: 'stnId',
      // Was a fixed 260px. A proportional minimum lets the column grow on wide
      // screens and shrink (with ellipsis) on narrow ones instead of forcing
      // the whole table into horizontal scroll.
      minWidth: 200,
      ellipsis: true,
      render: (_, row) => (
        <div className="wqm-station-summary">
          <strong>{row.stnId}</strong>
          <span>{row.address}</span>
        </div>
      ),
    },
    {
      title: 'Parameters',
      dataIndex: 'parameterCount',
      width: 118,
      align: 'center',
      render: (value) => <Tag color="blue">{value} parameters</Tag>,
    },
    {
      title: 'Latest Readings',
      dataIndex: 'latestValues',
      minWidth: 220,
      render: (values) => (
        <div className="wqm-latest-list">
          {values.length
            ? values.map((value, index) => <span key={`${index}-${value}`}>{value}</span>)
            : <span className="wqm-muted">No readings</span>}
        </div>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: canEditYear ? 132 : 56,
      align: 'center',
      // `fixed: 'right'` permanently splits the table into two scrolling panes.
      // With the columns now fitting the container, the split is unnecessary
      // below the breakpoint where a scrollbar would appear at all.
      fixed: 'right',
      render: (_, row) => (
        <Space size={6} wrap>
          <Button size="small" icon={<EyeOutlined />} title="View station details" aria-label="View station details" onClick={() => openStationModal('view', row.station)} />
          {canEditYear && (
            <>
              <Button size="small" type="primary" icon={<EditOutlined />} title="Edit station" aria-label="Edit station" onClick={() => openStationModal('edit', row.station)} />
              <Popconfirm
                title="Delete station?"
                description={isLocalYear(year) ? `Remove ${row.stnId} from the encrypted local draft.` : `Remove ${row.stnId} and save WQM ${year} to MongoDB.`}
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
  ], [canEditYear, openStationModal, deleteStation, year]);

  const classLabel = sheet?.classInfo?.match(/CLASS\s+(\S+)/)?.[1] || '';
  const visibleMonthIndices = useMemo(() => {
    if (!stationDraft) return MONTHS_SHORT.map((_, index) => index);
    // When adding or editing a station, expose all 12 months so previously
    // blank months can be filled in. Only the read-only view collapses to the
    // months that already have readings.
    if (modalMode === 'add' || modalMode === 'edit') return MONTHS_SHORT.map((_, index) => index);

    return MONTHS_SHORT
      .map((_, index) => index)
      .filter((monthIndex) => modalParams.some((param) => {
        const value = stationDraft.params?.[param]?.monthly?.[monthIndex];
        return isFilledMonthValue(value);
      }));
  }, [modalMode, modalParams, stationDraft]);

  const modalParameterColumns = [
    {
      title: 'Parameter',
      dataIndex: 'param',
      // fixed: 'left',
      width: 96,
      render: (param) => {
        if (param === DATE_ROW_KEY) {
          return (
            <div className="wqm-param-text">
              <span className="wqm-param-name">Date of Sampling</span>
            </div>
          );
        }
        const standard = getWqgStandard(param);
        return (
          <div className="wqm-param-text">
            <span className="wqm-param-name">{getDisplayParamName(param)}</span>
            {standard && <Tag color="green" className="wqm-wqg-tag">WQG: {standard}</Tag>}
          </div>
        );
      },
    },
    ...visibleMonthIndices.map((monthIndex) => ({
      key: `month-${monthIndex}`,
      title: periodLabels[monthIndex] || MONTHS_SHORT[monthIndex],
      dataIndex: ['monthly', monthIndex],
      width: 62,
      render: (_, row) => {
        if (row.param === DATE_ROW_KEY) {
          const rawValue = stationDraft?.samplingDates?.[monthIndex] ?? '';
          // Parse the stored MM/DD/YYYY string back to a dayjs object for the picker.
          const dayjsValue = rawValue
            ? (() => { const d = dayjs(rawValue, 'MM/DD/YYYY', true); return d.isValid() ? d : null; })()
            : null;
          return (
            <DatePicker
              className="wqm-sampling-date-picker"
              size="small"
              format="MM/DD/YYYY"
              placeholder="MM/DD/YYYY"
              value={dayjsValue}
              disabled={isReadOnlyModal}
              allowClear
              style={{ width: '100%' }}
              getPopupContainer={(trigger) => trigger.closest('.ant-modal-body') || document.body}
              onChange={(date) =>
                setDraftSamplingDate(monthIndex, date ? date.format('MM/DD/YYYY') : '')
              }
            />
          );
        }
        const isObservation = normalizeParamName(row.param) === OBSERVATION_PARAM;
        const value = stationDraft?.params?.[row.param]?.monthly?.[monthIndex] ?? '';
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
      width: 64,
      render: (_, row) => {
        if (row.param === DATE_ROW_KEY) return <span className="wqm-muted">-</span>;
        return normalizeParamName(row.param) === OBSERVATION_PARAM
          ? <span className="wqm-muted">-</span>
          : <Input size="small" value={stationDraft?.params?.[row.param]?.avg ?? ''} />;
      },
    },
  ];
  const modalParameterRows = [
    { key: DATE_ROW_KEY, param: DATE_ROW_KEY, monthly: [], avg: '' },
    ...modalParams.map((param) => ({
      key: param,
      param,
      monthly: stationDraft?.params?.[param]?.monthly || [],
      avg: stationDraft?.params?.[param]?.avg ?? '',
    })),
  ];

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
                {canEditYear ? <Tag color="gold">{isLocalYear(year) ? (user?.role === 'developer' ? 'Developer CRUD' : 'Admin CRUD') : (user?.role === 'developer' ? 'Developer — MongoDB' : 'Admin — MongoDB')}</Tag> : <Tag>Read only</Tag>}
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
                  {!isLocalYear(year) && (
                    <Popconfirm
                      title="Reload from server?"
                      description={`Discards changes in this browser that were not saved, and reloads WQM ${year} from MongoDB.`}
                      okText="Reload"
                      cancelText="Cancel"
                      onConfirm={reloadFromServer}
                    >
                      <Button icon={<ReloadOutlined />}>Reload from Server</Button>
                    </Popconfirm>
                  )}
                  <Popconfirm
                    title={`Delete "${sheet?.name}"?`}
                    description={isLocalYear(year) ? 'This removes the waterbody from the local draft.' : `This removes the waterbody and saves WQM ${year} to MongoDB.`}
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
              {message || 'Read-only mode. Only administrators and developers can edit this dataset.'}
            </div>
          )}
          <Table
            className="wqm-ant-table wqm-stations-table"
            size="small"
            rowKey="key"
            columns={columns}
            dataSource={stationRows}
            scroll={{ x: 720, y: 'calc(100dvh - 340px)' }}
            pagination={tablePagination}
            loading={saving}
          />
        </Content>
        )}
      </Layout>

      <Modal
        title={modalMode === 'add' ? 'Add Station' : modalMode === 'edit' ? 'Edit Station' : 'Station Details'}
        open={Boolean(modalMode)}
        onCancel={closeModal}
        width="min(96vw, 1880px)"
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
              <label className="station-no-field">
                <span>Station No.</span>
                <Input value={stationDraft.stnNo} disabled={isReadOnlyModal} onChange={(event) => setDraftField('stnNo', event.target.value)} />
              </label>
              <label className="station-id-field">
                <span>Station ID</span>
                <Input value={stationDraft.stnId} disabled={isReadOnlyModal} onChange={(event) => setDraftField('stnId', event.target.value)} />
              </label>
              <label className="station-class-field">
                <span>Class</span>
                <Input value={stationDraft.classInfo} placeholder="e.g. C, SB" disabled={isReadOnlyModal} onChange={(event) => setDraftField('classInfo', event.target.value)} />
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
              tableLayout="fixed"
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

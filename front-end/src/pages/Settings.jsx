import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Form,
  Input,
  Modal,
  Progress,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
} from "antd";
import {
  CheckCircleOutlined,
  CheckOutlined,
  CloseCircleOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EnvironmentOutlined,
  FileTextOutlined,
  LineChartOutlined,
  MailOutlined,
  ReloadOutlined,
  SafetyOutlined,
  SendOutlined,
  SettingOutlined,
  TeamOutlined,
  UploadOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import api from "../api/axios";
import encryptedStorage from "../utils/encryptedStorage";
import { loadStationLocationsCached } from "../utils/stationWorkbook";
import {
  buildWaterbodyOptions,
  getAllStations,
  getReadableStations,
  getStoredWqmSheets,
  groupWaterbodyByProvince,
  publishWqmYear,
  saveStoredWqmSheets,
  WQM_DRAFTS_KEY,
  WQM_PUBLISHED_YEAR_KEY,
  WQM_YEAR_OPTIONS,
  useWqmSheets,
  useAllYearSheets,
  getYearSheetsLocal,
  saveYearSheetsLocal,
} from "../utils/wqmSheets";
import {
  MONTHS_SHORT,
  getAvailableParams,
  getMonthlyNumber,
  getParamData,
} from "../utils/wqmData";
import {
  getLineChartMergeSettings,
  setLineChartMergeSettings,
  buildMultiYearTrend,
} from "../utils/lineChartSettings";
import { clearAppLogs, getAppLogs, logActivity } from "../utils/appLog";
import {
  getForecastMonths,
  setForecastMonths as setForecastMonthsSetting,
} from "../utils/forecastSettings";
import { confirmAction, toastSaved, alertError } from "../utils/swal";
import ChartConfiguration from "./ChartConfiguration";
import "./Settings.css";

const ROLES = ["user", "developer", "admin"];
const STATUS_LABELS = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};
const VISUALIZATION_YEAR_OPTIONS = WQM_YEAR_OPTIONS.map((year) => [
  String(year),
  year === 2026 ? "2026 active dataset" : `${year} MongoDB dataset`,
]);

const ACCESS_FEATURES = [
  ["dashboard", "Dashboard", "user"],
  ["visualizations", "Visual Analytics", "user"],
  ["waterbodies", "Waterbody Profiles", "user"],
  ["tabular", "Tabular Results", "user"],
  ["tabularCrud", "Tabular CRUD", "admin"],
  ["developerManager", "Developer Manager", "developer"],
  ["settings", "Settings", "developer"],
];

const getStationAssignmentKey = (waterbodyKey, station) =>
  [
    waterbodyKey,
    station?.stnNo ?? "",
    station?.stnId ?? "",
    station?.address ?? "",
  ].join("::");

const normalizeForMatch = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const getLocationStationNumber = (location) => {
  const match = String(location?.id || "").match(/(?:^|_)(\d+)$/);
  return match ? Number(match[1]) : null;
};

const matchStationLocation = (station, waterbody, stationLocations) => {
  const waterbodyName = normalizeForMatch(waterbody?.name);
  const stationNo = Number(station?.stnNo);
  const stationValues = [station?.stnId, station?.address]
    .map(normalizeForMatch)
    .filter(Boolean);
  return (
    stationLocations.find((location) => {
      const locationWaterbody = normalizeForMatch(location.waterbodyRiver);
      if (
        waterbodyName &&
        locationWaterbody &&
        locationWaterbody !== waterbodyName
      )
        return false;
      if (
        Number.isFinite(stationNo) &&
        getLocationStationNumber(location) === stationNo
      )
        return true;
      const locationValues = [
        location.station,
        location.barangay,
        location.province,
      ]
        .map(normalizeForMatch)
        .filter(Boolean);
      return stationValues.some((value) =>
        locationValues.some(
          (locationValue) =>
            value === locationValue ||
            value.includes(locationValue) ||
            locationValue.includes(value),
        ),
      );
    }) || null
  );
};

const getStoredAccessSettings = () => {
  try {
    const stored = encryptedStorage.getItem("wqms_access_settings");
    return Object.fromEntries(
      ACCESS_FEATURES.map(([key, , fallback]) => [
        key,
        stored?.[key] || fallback,
      ]),
    );
  } catch {
    return Object.fromEntries(
      ACCESS_FEATURES.map(([key, , fallback]) => [key, fallback]),
    );
  }
};

const USER_ACCESS_KEY = "wqms_user_access";

const getUserAccessOverrides = () => {
  try {
    return encryptedStorage.getItem(USER_ACCESS_KEY) || {};
  } catch {
    return {};
  }
};

const ACCESS_ROLE_RANK = { user: 1, developer: 2, admin: 3 };

// Whether a role is allowed into a feature by the global minimum-role rule.
const isDefaultFeatureAllowed = (feature, role) => {
  const settings = getStoredAccessSettings();
  return (
    (ACCESS_ROLE_RANK[role] || 0) >=
    (ACCESS_ROLE_RANK[settings[feature] || "user"] || 1)
  );
};

const ManageAccessModal = ({ open, onClose, currentUser }) => {
  const [settings, setSettings] = useState(getStoredAccessSettings);

  const updateAccess = (feature, role) => {
    const next = { ...settings, [feature]: role };
    setSettings(next);
    encryptedStorage.setItem("wqms_access_settings", next);
    window.dispatchEvent(
      new CustomEvent("wqms:access-settings", { detail: next }),
    );
    toastSaved("Access settings saved.");
    logActivity("Updated app access settings", { feature, role }, currentUser);
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <Space>
          <SafetyOutlined />
          <span>Global Access Settings</span>
        </Space>
      }
      footer={
        <Button type="primary" onClick={onClose}>
          Done
        </Button>
      }
      width={560}
    >
      <p style={{ marginTop: 0, color: "var(--text-muted, #6b7280)", fontSize: 13 }}>
        Set the minimum role allowed to open each major app area. Changes apply
        immediately for all accounts.
      </p>
      <Row gutter={[12, 12]}>
        {ACCESS_FEATURES.map(([key, label]) => (
          <Col xs={24} sm={12} key={key}>
            <div style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
              <Select
                value={settings[key]}
                onChange={(value) => updateAccess(key, value)}
                options={ROLES.map((role) => ({ value: role, label: role }))}
              />
            </div>
          </Col>
        ))}
      </Row>
    </Modal>
  );
};

const VisualizationYearSettings = ({ currentUser }) => {
  const [year, setYear] = useState(
    () => encryptedStorage.getItem(WQM_PUBLISHED_YEAR_KEY) || "2026",
  );
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(true);

  const publishYear = useCallback((nextYear) => {
    const normalized = String(publishWqmYear(nextYear));
    setYear(normalized);
  }, []);

  useEffect(() => {
    let mounted = true;
    api
      .get("/admin/settings/visualization-year")
      .then(({ data }) => {
        if (mounted) publishYear(data?.year || 2026);
      })
      .catch((error) => {
        if (mounted)
          setSaved(
            error.response?.data?.message ||
              "Using local published WQM year until server setting loads.",
          );
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [publishYear]);

  const updateYear = async (nextYear) => {
    publishYear(nextYear);
    setSaved("");
    try {
      const { data } = await api.patch("/admin/settings/visualization-year", {
        year: Number(nextYear),
      });
      publishYear(data?.year || nextYear);
      setSaved(`Published WQM year set to ${data?.year || nextYear}.`);
      logActivity(
        "Updated published WQM year",
        { year: String(data?.year || nextYear) },
        currentUser,
      );
    } catch (error) {
      setSaved(
        error.response?.data?.message ||
          "Unable to save published WQM year to MongoDB.",
      );
    }
  };

  return (
    <Card
      variant="borderless"
      size="small"
      title={
        <Space>
          <DatabaseOutlined />
          <span>Published WQM Year</span>
        </Space>
      }
    >
      <p
        style={{
          margin: "0 0 12px",
          fontSize: 13,
          color: "var(--text-muted, #6b7280)",
        }}
      >
        Sets the WQM dataset used by dashboard, visual analytics, and monitoring.
        The selection is saved in MongoDB and shared across sessions.
      </p>
      <Space wrap align="center">
        <Select
          value={year}
          disabled={loading}
          loading={loading}
          onChange={(value) => updateYear(value)}
          style={{ minWidth: 220 }}
          options={VISUALIZATION_YEAR_OPTIONS.map(([value, label]) => ({
            value,
            label,
          }))}
        />
        {saved && (
          <Tag color="success" icon={<CheckCircleOutlined />}>
            {saved}
          </Tag>
        )}
      </Space>
    </Card>
  );
};

const PAST_YEARS = WQM_YEAR_OPTIONS.filter((y) => y !== 2026).sort((a, b) => b - a); // [2025, 2024]
const ALL_EDITABLE_YEARS = [2026, ...PAST_YEARS]; // newest first

const WaterbodyProfileSettings = ({ currentUser }) => {
  // ── Year selector ──────────────────────────────────────────────────────
  const [activeYear, setActiveYear] = useState(2026);

  // 2026: live local sheets. Past years: loaded via useAllYearSheets.
  const liveSheets = useWqmSheets();
  const { map: histMap, loading: histLoading } = useAllYearSheets(
    activeYear !== 2026 ? [activeYear] : [],
  );

  const sheets = activeYear === 2026
    ? liveSheets
    : (histMap.get(activeYear) || []);

  // ── Main panel state ───────────────────────────────────────────────────
  const waterbodies = useMemo(() => buildWaterbodyOptions(sheets), [sheets]);
  const [stationLocations, setStationLocations] = useState([]);
  const [settings, setSettings] = useState(() => {
    try {
      return encryptedStorage.getItem("wqms_waterbody_profile_settings") || {};
    } catch {
      return {};
    }
  });
  const [editStation, setEditStation] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  // Local drafts for the past-year profile modal so the inputs stay responsive
  // regardless of how quickly the cached sheets refresh.
  const [profileNameDraft, setProfileNameDraft] = useState("");
  const [profileClassDraft, setProfileClassDraft] = useState("");

  const provinceGroups = useMemo(() => groupWaterbodyByProvince(waterbodies), [waterbodies]);
  const activeKey = waterbodies[0]?.key || "";
  const [selectedKey, setSelectedKey] = useState(activeKey);

  // Re-select first waterbody when the year changes.
  useEffect(() => {
    setSelectedKey(waterbodies[0]?.key || "");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeYear]);

  const selectedWaterbody =
    waterbodies.find((item) => item.key === selectedKey) || waterbodies[0];
  const selectedSheet = sheets.find(
    (sheet) => sheet.key === selectedWaterbody?.key,
  );
  const selectedStations = useMemo(
    () => getAllStations(selectedSheet),
    [selectedSheet],
  );
  const current = settings[selectedWaterbody?.key] || {};
  const stationAssignments = useMemo(
    () => current.stationAssignments || {},
    [current.stationAssignments],
  );
  const stationOverrides = useMemo(
    () => current.stationOverrides || {},
    [current.stationOverrides],
  );

  useEffect(() => {
    let cancelled = false;
    loadStationLocationsCached()
      .then((locations) => {
        if (!cancelled) setStationLocations(locations);
      })
      .catch(() => {
        if (!cancelled) setStationLocations([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedKey && activeKey) {
      queueMicrotask(() => setSelectedKey(activeKey));
    }
  }, [activeKey, selectedKey]);

  // Seed the profile modal drafts whenever it opens (or the waterbody changes).
  useEffect(() => {
    if (profileOpen && selectedSheet) {
      setProfileNameDraft(selectedSheet.name || selectedWaterbody?.name || "");
      setProfileClassDraft(selectedSheet.classInfo || "");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileOpen, selectedWaterbody?.key, activeYear]);

  // ── Profile-level setting update (2026 only) ───────────────────────────
  const updateSetting = (field, value) => {
    if (!selectedWaterbody) return;
    const latestSettings = encryptedStorage.getItem("wqms_waterbody_profile_settings") || {};
    const latestCurrent = latestSettings[selectedWaterbody.key] || {};
    const next = {
      ...latestSettings,
      [selectedWaterbody.key]: {
        ...latestCurrent,
        [field]: value,
      },
    };
    setSettings(next);
    encryptedStorage.setItem("wqms_waterbody_profile_settings", next);
    window.dispatchEvent(
      new CustomEvent("wqms:waterbody-profile-settings", { detail: next }),
    );
    logActivity(
      "Updated waterbody profile settings",
      { waterbody: selectedWaterbody.name, field, year: activeYear },
      currentUser,
    );
  };

  // ── Station-level edits persisted directly to year sheets ─────────────
  const updateStationField = useCallback((stationNo, field, value) => {
    const current = activeYear === 2026
      ? getStoredWqmSheets()
      : (getYearSheetsLocal(activeYear) || sheets);
    const next = current.map((sheet) =>
      sheet.key !== selectedWaterbody?.key ? sheet : {
        ...sheet,
        stations: sheet.stations.map((stn) =>
          String(stn.stnNo) !== String(stationNo) ? stn : { ...stn, [field]: value },
        ),
      },
    );
    saveYearSheetsLocal(activeYear, next);
    logActivity(
      `Edited station ${field} in WQM ${activeYear}`,
      { waterbody: selectedWaterbody?.name, stationNo, field },
      currentUser,
    );
  }, [activeYear, selectedWaterbody, sheets, currentUser]);

  // ── Waterbody classInfo edit ───────────────────────────────────────────
  const updateWaterbodyClassInfo = useCallback((classInfo) => {
    const current = activeYear === 2026
      ? getStoredWqmSheets()
      : (getYearSheetsLocal(activeYear) || sheets);
    const next = current.map((sheet) =>
      sheet.key !== selectedWaterbody?.key ? sheet : { ...sheet, classInfo },
    );
    saveYearSheetsLocal(activeYear, next);
    logActivity(
      `Updated waterbody classInfo in WQM ${activeYear}`,
      { waterbody: selectedWaterbody?.name, classInfo },
      currentUser,
    );
  }, [activeYear, selectedWaterbody, sheets, currentUser]);

  // ── Waterbody name edit (writes the raw sheet name; persisted on push) ──
  const updateWaterbodyName = useCallback((name) => {
    const current = activeYear === 2026
      ? getStoredWqmSheets()
      : (getYearSheetsLocal(activeYear) || sheets);
    const next = current.map((sheet) =>
      sheet.key !== selectedWaterbody?.key ? sheet : { ...sheet, name },
    );
    saveYearSheetsLocal(activeYear, next);
    logActivity(
      `Updated waterbody name in WQM ${activeYear}`,
      { waterbody: selectedWaterbody?.key, name },
      currentUser,
    );
  }, [activeYear, selectedWaterbody, sheets, currentUser]);

  // ── For past years: push edits to MongoDB ─────────────────────────────
  const pushYearToServer = async () => {
    if (activeYear === 2026 || syncing) return;
    const local = getYearSheetsLocal(activeYear);
    if (!local || !local.length) {
      alertError(`No local data for ${activeYear} to push.`);
      return;
    }
    const confirmed = await confirmAction({
      title: `Push ${activeYear} edits to MongoDB?`,
      text: `This overwrites the server's WQM ${activeYear} dataset with your locally-edited copy. Chart Configuration and historical charts will reflect the updates.`,
      confirmButtonText: `Yes, push ${activeYear}`,
    });
    if (!confirmed) return;
    setSyncing(true);
    try {
      await api.put(`/water/wqm/${activeYear}`, { sheets: local });
      toastSaved(`WQM ${activeYear} pushed to the server. Chart Configuration will now use the updated data.`);
      logActivity(`Pushed WQM ${activeYear} edits to server`, {}, currentUser);
    } catch (err) {
      alertError(err?.response?.data?.message || `Failed to push WQM ${activeYear}.`);
    } finally {
      setSyncing(false);
    }
  };

  // ── Re-fetch past year from server (discard local edits) ──────────────
  const refetchFromServer = async () => {
    if (activeYear === 2026) return;
    const confirmed = await confirmAction({
      title: `Re-fetch WQM ${activeYear} from server?`,
      text: `This discards any local edits you made to the ${activeYear} dataset and replaces them with the server copy.`,
      confirmButtonText: 'Yes, re-fetch',
      danger: true,
    });
    if (!confirmed) return;
    setSyncing(true);
    try {
      const res = await api.get(`/water/wqm/${activeYear}`);
      const fresh = res.data?.sheets || [];
      if (!fresh.length) throw new Error('Empty response from server.');
      encryptedStorage.setItem(`wqm_${activeYear}_drafts`, fresh);
      window.dispatchEvent(new CustomEvent('wqm:drafts-updated'));
      toastSaved(`WQM ${activeYear} refreshed from server.`);
      logActivity(`Re-fetched WQM ${activeYear} from server`, {}, currentUser);
    } catch (err) {
      alertError(err?.response?.data?.message || `Failed to fetch WQM ${activeYear}.`);
    } finally {
      setSyncing(false);
    }
  };

  // ── Delete waterbody (any year). Past-year deletions are persisted to
  //    MongoDB when the dev pushes the year to the server. ────────────────
  const deleteWaterbody = async () => {
    if (!selectedWaterbody) return;
    const past = activeYear !== 2026;
    const confirmed = await confirmAction({
      title: `Delete "${selectedWaterbody.name}"${past ? ` from WQM ${activeYear}` : ""}?`,
      text: past
        ? `This removes the waterbody from the local ${activeYear} copy. Use "Push edits to server" afterwards to permanently delete it from MongoDB.`
        : "This removes the waterbody from the local dataset. This cannot be undone without a page reload.",
      confirmButtonText: "Yes, delete",
      danger: true,
    });
    if (!confirmed) return;

    const currentSheets = activeYear === 2026
      ? getStoredWqmSheets()
      : (getYearSheetsLocal(activeYear) || sheets);
    const filtered = currentSheets.filter((s) => s.key !== selectedWaterbody.key);
    saveYearSheetsLocal(activeYear, filtered);

    if (!past) {
      const nextSettings = { ...settings };
      delete nextSettings[selectedWaterbody.key];
      setSettings(nextSettings);
      encryptedStorage.setItem("wqms_waterbody_profile_settings", nextSettings);
      window.dispatchEvent(
        new CustomEvent("wqms:waterbody-profile-settings", { detail: nextSettings }),
      );
    }

    const remaining = waterbodies.filter((w) => w.key !== selectedWaterbody.key);
    setSelectedKey(remaining[0]?.key || "");
    logActivity(
      `Deleted waterbody from WQM ${activeYear}`,
      { waterbody: selectedWaterbody.name, year: activeYear },
      currentUser,
    );
    toastSaved(
      `"${selectedWaterbody.name}" removed from WQM ${activeYear}.${past ? " Push edits to server to save the deletion." : ""}`,
    );
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
    updateSetting("stationAssignments", nextAssignments);
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
    updateSetting("stationOverrides", nextOverrides);
  };

  const stationRows = useMemo(
    () =>
      selectedStations.map((station) => {
        const assignmentKey = getStationAssignmentKey(selectedWaterbody?.key, station);
        const assignedKey = stationAssignments[assignmentKey] || selectedWaterbody?.key;
        const override = stationOverrides[assignmentKey] || {};
        const location = matchStationLocation(station, selectedWaterbody, stationLocations);
        const lat = override.lat ?? (Number.isFinite(location?.lat) ? String(location.lat) : "");
        const lng = override.lng ?? (Number.isFinite(location?.lng) ? String(location.lng) : "");
        return {
          key: assignmentKey,
          station,
          stnNo: station.stnNo,
          name: override.name ?? station.stnId ?? "",
          address: override.address ?? station.address ?? "",
          lat,
          lng,
          assignedKey,
        };
      }),
    [selectedStations, selectedWaterbody, stationAssignments, stationOverrides, stationLocations],
  );

  const waterbodyName = (key) =>
    waterbodies.find((w) => w.key === key)?.name || "—";

  const stationColumns = [
    { title: "No.", dataIndex: "stnNo", key: "stnNo", width: 60 },
    {
      title: "Station ID",
      dataIndex: "name",
      key: "name",
      render: (name, row) => (
        <strong style={{ fontWeight: 600 }}>{row.station.stnId || name || "—"}</strong>
      ),
    },
    {
      title: "Address",
      dataIndex: "address",
      key: "address",
      responsive: ["lg"],
      render: (address) => address || <em style={{ color: "#94a3b8" }}>—</em>,
    },
    {
      title: "Class",
      key: "classInfo",
      render: (_, row) => (
        <span style={{ fontSize: 12 }}>{row.station.classInfo || "—"}</span>
      ),
    },
    {
      title: "Coordinates",
      key: "coords",
      render: (_, row) =>
        row.lat && row.lng ? (
          <Tag icon={<EnvironmentOutlined />}>{row.lat}, {row.lng}</Tag>
        ) : (
          <Tag>Not set</Tag>
        ),
    },
    {
      title: "Assigned Waterbody",
      dataIndex: "assignedKey",
      key: "assignedKey",
      render: (key) => (
        <Tag color={key === selectedWaterbody?.key ? "default" : "geekblue"}>
          {waterbodyName(key)}
        </Tag>
      ),
    },
    {
      title: "Actions",
      key: "actions",
      width: 90,
      render: (_, row) => (
        <Button
          size="small"
          type="primary"
          icon={<EditOutlined />}
          onClick={() => setEditStation(row)}
        >
          Edit
        </Button>
      ),
    },
  ];

  const saveStationEdit = () => {
    toastSaved("Station updated.");
    setEditStation(null);
  };

  const isPastYear = activeYear !== 2026;

  return (
    <div className="waterbody-settings-panel">
      {/* ── Year selector ── */}
      <div className="wbs-year-bar">
        <span className="wbs-year-label">Editing year:</span>
        <div className="wbs-year-chips">
          {ALL_EDITABLE_YEARS.map((yr) => (
            <button
              key={yr}
              type="button"
              className={`wbs-year-chip${activeYear === yr ? " active" : ""}`}
              onClick={() => setActiveYear(yr)}
            >
              {yr}{yr === 2026 ? " (live)" : ""}
            </button>
          ))}
        </div>
        {isPastYear && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              loading={syncing}
              onClick={refetchFromServer}
            >
              Re-fetch from server
            </Button>
            <Button
              size="small"
              type="primary"
              icon={<CloudServerOutlined />}
              loading={syncing}
              onClick={pushYearToServer}
            >
              Push edits to server
            </Button>
          </div>
        )}
      </div>

      {isPastYear && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 14 }}
          message={`Editing WQM ${activeYear} data`}
          description={
            `Changes made here update the locally-cached copy of ${activeYear}. Use "Push edits to server" to persist them to MongoDB so Chart Configuration and historical charts always reflect the corrections.`
          }
        />
      )}

      {histLoading && isPastYear && (
        <div style={{ padding: "1rem 0", color: "var(--text-secondary)" }}>
          Loading {activeYear} data from server…
        </div>
      )}

      {/* ── Waterbody picker + profile actions ── */}
      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "flex-end",
          marginBottom: 16,
        }}
      >
        <div style={{ display: "grid", gap: 4, minWidth: 240 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Waterbody</span>
          <Select
            showSearch
            optionFilterProp="label"
            value={selectedWaterbody?.key || undefined}
            onChange={(value) => setSelectedKey(value)}
            style={{ minWidth: 240 }}
            options={provinceGroups.map(({ province, items }) => ({
              label: province,
              options: items.map((wb) => ({ value: wb.key, label: wb.name })),
            }))}
          />
        </div>
        <Button
          icon={<EditOutlined />}
          onClick={() => setProfileOpen(true)}
          disabled={!selectedWaterbody}
        >
          Edit Profile
        </Button>
        <Button
          danger
          icon={<DeleteOutlined />}
          onClick={deleteWaterbody}
          disabled={!selectedWaterbody}
        >
          Delete Waterbody{isPastYear ? ` (${activeYear})` : ""}
        </Button>
      </div>

      {selectedWaterbody && (
        <>
          <div className="station-regroup-head">
            <div>
              <h4>
                Station Regrouping &amp; Locations
                {isPastYear && (
                  <Tag color="orange" style={{ marginLeft: 8, fontWeight: 400, fontSize: 11 }}>
                    WQM {activeYear}
                  </Tag>
                )}
              </h4>
              <p>
                Edit station IDs, class, coordinates, and addresses.
                {isPastYear ? ` Changes affect the ${activeYear} dataset used by Chart Configuration.` : ' Moves stations between waterbodies.'}
              </p>
            </div>
            <Tag color="blue">{selectedStations.length} stations</Tag>
          </div>
          <Table
            rowKey="key"
            size="middle"
            columns={stationColumns}
            dataSource={stationRows}
            pagination={{ pageSize: 10, showSizeChanger: true }}
            scroll={{ x: "max-content" }}
            locale={{ emptyText: `No stations are available for this waterbody in WQM ${activeYear}.` }}
          />
        </>
      )}

      {/* Profile edit modal */}
      <Modal
        open={profileOpen}
        onCancel={() => setProfileOpen(false)}
        title={
          <Space>
            <EditOutlined />
            <span>Edit Waterbody Profile {isPastYear ? `(WQM ${activeYear})` : ""}</span>
          </Space>
        }
        footer={
          <Button
            type="primary"
            onClick={() => {
              setProfileOpen(false);
              toastSaved("Profile settings saved.");
            }}
          >
            Done
          </Button>
        }
        width={560}
      >
        {selectedWaterbody && (
          <Form layout="vertical" style={{ marginTop: 8 }}>
            {activeYear === 2026 ? (
              <>
                <Form.Item label="Profile Name" style={{ marginBottom: 12 }}>
                  <Input
                    value={current.profileName || selectedWaterbody.name}
                    onChange={(e) => updateSetting("profileName", e.target.value)}
                  />
                </Form.Item>
                <Form.Item label="Waterbody Assignment" style={{ marginBottom: 12 }}>
                  <Input
                    value={current.assignedWaterbody || selectedWaterbody.name}
                    onChange={(e) => updateSetting("assignedWaterbody", e.target.value)}
                  />
                </Form.Item>
                <Form.Item label="Station Location Source" style={{ marginBottom: 12 }}>
                  <Select
                    value={current.locationSource || "workbook"}
                    onChange={(value) => updateSetting("locationSource", value)}
                    options={[
                      { value: "workbook", label: "Workbook station list" },
                      { value: "manual", label: "Manual assignment" },
                    ]}
                  />
                </Form.Item>
                <Form.Item label="Profile Notes" style={{ marginBottom: 0 }}>
                  <Input.TextArea
                    rows={3}
                    value={current.notes || ""}
                    onChange={(e) => updateSetting("notes", e.target.value)}
                  />
                </Form.Item>
              </>
            ) : (
              <>
                <Form.Item label="Waterbody Name" style={{ marginBottom: 12 }}>
                  <Input
                    placeholder="e.g. Baler Bay"
                    value={profileNameDraft}
                    onChange={(e) => {
                      setProfileNameDraft(e.target.value);
                      updateWaterbodyName(e.target.value);
                    }}
                  />
                </Form.Item>
                <Form.Item label="Waterbody Class" style={{ marginBottom: 12 }}>
                  <Input
                    placeholder="e.g. C, SB"
                    value={profileClassDraft}
                    onChange={(e) => {
                      setProfileClassDraft(e.target.value);
                      updateWaterbodyClassInfo(e.target.value);
                    }}
                  />
                </Form.Item>
                <Alert
                  type="info"
                  showIcon
                  message={`After editing, use "Push edits to server" on the main panel to permanently save WQM ${activeYear} changes to MongoDB.`}
                />
              </>
            )}
          </Form>
        )}
      </Modal>

      {/* Station edit modal */}
      <Modal
        open={Boolean(editStation)}
        onCancel={() => setEditStation(null)}
        title={
          <Space>
            <EnvironmentOutlined />
            <span>Edit Station{isPastYear ? ` (WQM ${activeYear})` : ""}</span>
          </Space>
        }
        okText="Save"
        onOk={saveStationEdit}
        width={700}
        destroyOnClose
      >
        {editStation && (
          <Form layout="vertical" style={{ marginTop: 8 }}>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item label="Station ID" style={{ marginBottom: 12 }}>
                  <Input
                    value={editStation.station.stnId}
                    onChange={(e) => {
                      const v = e.target.value;
                      updateStationField(editStation.stnNo, "stnId", v);
                      setEditStation((s) => ({ ...s, station: { ...s.station, stnId: v }, name: v }));
                    }}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="Class" style={{ marginBottom: 12 }}>
                  <Input
                    placeholder="e.g. C, SB"
                    value={editStation.station.classInfo || ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      updateStationField(editStation.stnNo, "classInfo", v);
                      setEditStation((s) => ({ ...s, station: { ...s.station, classInfo: v } }));
                    }}
                  />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item label="Station Name Override (display)" style={{ marginBottom: 12 }}>
              <Input
                value={editStation.name}
                onChange={(e) => {
                  if (activeYear === 2026) {
                    updateStationOverride(editStation.station, "name", e.target.value);
                  }
                  setEditStation((s) => ({ ...s, name: e.target.value }));
                }}
              />
            </Form.Item>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item label="Latitude" style={{ marginBottom: 12 }}>
                  <Input
                    inputMode="decimal"
                    placeholder="e.g. 14.9057"
                    value={editStation.lat}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (activeYear === 2026) updateStationOverride(editStation.station, "lat", v);
                      else updateStationField(editStation.stnNo, "lat", v);
                      setEditStation((s) => ({ ...s, lat: v }));
                    }}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="Longitude" style={{ marginBottom: 12 }}>
                  <Input
                    inputMode="decimal"
                    placeholder="e.g. 121.0641"
                    value={editStation.lng}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (activeYear === 2026) updateStationOverride(editStation.station, "lng", v);
                      else updateStationField(editStation.stnNo, "lng", v);
                      setEditStation((s) => ({ ...s, lng: v }));
                    }}
                  />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item label="Address" style={{ marginBottom: isPastYear ? 12 : 0 }}>
              <Input
                placeholder="Barangay, Municipality, Province"
                value={editStation.address}
                onChange={(e) => {
                  const v = e.target.value;
                  if (activeYear === 2026) updateStationOverride(editStation.station, "address", v);
                  else updateStationField(editStation.stnNo, "address", v);
                  setEditStation((s) => ({ ...s, address: v }));
                }}
              />
            </Form.Item>
            {!isPastYear && (
              <Form.Item label="Assigned Waterbody" style={{ marginBottom: 0 }}>
                <Select
                  value={editStation.assignedKey}
                  onChange={(value) => {
                    updateStationAssignment(editStation.station, value);
                    setEditStation((s) => ({ ...s, assignedKey: value }));
                  }}
                  options={waterbodies.map((wb) => ({
                    value: wb.key,
                    label: wb.name,
                  }))}
                />
              </Form.Item>
            )}
            {isPastYear && (
              <Alert
                type="info"
                showIcon
                message={`Changes will be saved to the local ${activeYear} copy. Push to server to persist across all views.`}
              />
            )}
          </Form>
        )}
      </Modal>
    </div>
  );
};

const SystemInfo = ({ mode = "all" }) => {
  const [info, setInfo] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadInfo = useCallback(() => {
    setRefreshing(true);
    api
      .get("/admin/system")
      .then((r) => setInfo(r.data))
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(() => {
    queueMicrotask(loadInfo);
  }, [loadInfo]);

  if (!info)
    return (
      <Card variant="borderless">
        <div className="panel-loading">Loading runtime status...</div>
      </Card>
    );

  const uptimeHours = Math.floor(info.uptime / 3600);
  const uptimeMinutes = Math.floor((info.uptime % 3600) / 60);
  const dbConnected = info.dbStatus === "connected";
  const memoryPercent = Math.min(100, Math.round((info.memoryMB / 256) * 100));

  const runtimeItems = [
    ["Node.js", info.nodeVersion],
    ["Platform", info.platform],
    ["Hostname", info.hostname],
    ["Environment", info.env],
  ];

  const memoryData = [
    { name: "Used", value: info.memoryMB, color: "#446ACB" },
    {
      name: "Reserve",
      value: Math.max(256 - info.memoryMB, 24),
      color: "#D6DBF6",
    },
  ];
  const runtimeSeries = [
    { name: "Start", memory: Math.max(info.memoryMB - 18, 8), uptime: 0 },
    { name: "Now", memory: info.memoryMB, uptime: Math.max(uptimeHours, 1) },
  ];

  return (
    <Space orientation="vertical" size="large" style={{ width: "100%" }}>
      <Row gutter={[12, 12]}>
        <Col xs={24} sm={12} lg={6}>
          <Card variant="borderless" className="settings-stat-card">
            <Statistic
              title="Memory Used"
              value={info.memoryMB}
              suffix="MB"
              prefix={<CloudServerOutlined style={{ color: "#446ACB" }} />}
            />
            <Progress
              percent={memoryPercent}
              size="small"
              showInfo={false}
              strokeColor="#446ACB"
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card variant="borderless" className="settings-stat-card">
            <Statistic
              title="Uptime"
              value={`${uptimeHours}h ${uptimeMinutes}m`}
              prefix={<ReloadOutlined style={{ color: "#7CB675" }} />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card variant="borderless" className="settings-stat-card">
            <Statistic
              title="Database"
              value={dbConnected ? "Connected" : "Offline"}
              valueStyle={{ color: dbConnected ? "#16a34a" : "#dc2626" }}
              prefix={
                <Badge status={dbConnected ? "success" : "error"} />
              }
            />
            <span style={{ fontSize: 12, color: "var(--text-muted, #6b7280)" }}>
              {info.dbName || "Not connected"}
            </span>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card variant="borderless" className="settings-stat-card">
            <Statistic
              title="Environment"
              value={info.env || "—"}
              prefix={<DatabaseOutlined style={{ color: "#f59e0b" }} />}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[12, 12]}>
        <Col xs={24} lg={mode === "database" ? 24 : 10}>
          <Card
            variant="borderless"
            title={
              <Space>
                <CloudServerOutlined />
                <span>Runtime Details</span>
              </Space>
            }
            extra={
              <Button
                size="small"
                icon={<ReloadOutlined />}
                loading={refreshing}
                onClick={loadInfo}
              >
                Refresh
              </Button>
            }
          >
            <Descriptions
              column={1}
              size="small"
              items={runtimeItems.map(([label, value]) => ({
                key: label,
                label,
                children: value,
              }))}
            />
          </Card>
        </Col>
        {mode !== "database" && (
          <Col xs={24} lg={14}>
            <Card
              variant="borderless"
              title={
                <Space>
                  <LineChartOutlined />
                  <span>Resource Monitor</span>
                </Space>
              }
            >
              <Row gutter={12}>
                <Col xs={24} sm={10}>
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie
                        data={memoryData}
                        dataKey="value"
                        innerRadius={46}
                        outerRadius={72}
                        paddingAngle={4}
                      >
                        {memoryData.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      <RechartsTooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </Col>
                <Col xs={24} sm={14}>
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={runtimeSeries}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="var(--border)"
                      />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <RechartsTooltip />
                      <Line
                        type="monotone"
                        dataKey="memory"
                        stroke="#446ACB"
                        strokeWidth={2.4}
                        dot
                      />
                      <Line
                        type="monotone"
                        dataKey="uptime"
                        stroke="#7CB675"
                        strokeWidth={2.4}
                        dot
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </Col>
              </Row>
            </Card>
          </Col>
        )}
      </Row>
    </Space>
  );
};

const ROLE_TAG_COLORS = { admin: "red", developer: "geekblue", user: "default" };
const STATUS_TAG_COLORS = {
  approved: "success",
  pending: "warning",
  rejected: "error",
};

const AccountsPanel = ({ currentUser }) => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [accessOpen, setAccessOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [userDraft, setUserDraft] = useState(null);
  const [userAccessDraft, setUserAccessDraft] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    api
      .get("/admin/users")
      .then((r) => {
        if (mounted) setUsers(r.data);
      })
      .catch(() => {
        if (mounted) alertError("Failed to load users.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return users;
    return users.filter(
      (u) =>
        u.name?.toLowerCase().includes(term) ||
        u.email?.toLowerCase().includes(term) ||
        u.role?.toLowerCase().includes(term),
    );
  }, [users, search]);

  const pendingUsers = useMemo(
    () => users.filter((u) => (u.status || "approved") === "pending"),
    [users],
  );

  const changeStatus = async (user, status) => {
    try {
      const { data } = await api.patch(`/admin/users/${user._id}/status`, {
        status,
      });
      setUsers((prev) => prev.map((u) => (u._id === data._id ? data : u)));
      toastSaved(
        status === "approved"
          ? `${data.name} approved.`
          : status === "rejected"
            ? `${data.name} rejected.`
            : `${data.name} set to ${status}.`,
      );
      logActivity(
        "Reviewed account status",
        { user: data.email, status },
        currentUser,
      );
    } catch (e) {
      alertError(e.response?.data?.message || "Could not update account status.");
    }
  };

  const deleteUser = async (user) => {
    const confirmed = await confirmAction({
      title: `Delete "${user.name}"?`,
      text: "This permanently removes the account and cannot be undone.",
      icon: "warning",
      confirmButtonText: "Yes, delete",
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api.delete(`/admin/users/${user._id}`);
      setUsers((prev) => prev.filter((u) => u._id !== user._id));
      const overrides = getUserAccessOverrides();
      if (overrides[user._id]) {
        const { [user._id]: _removed, ...rest } = overrides;
        encryptedStorage.setItem(USER_ACCESS_KEY, rest);
        window.dispatchEvent(
          new CustomEvent("wqms:access-settings", { detail: rest }),
        );
      }
      toastSaved(`User "${user.name}" deleted.`);
      logActivity("Deleted user account", { user: user.name }, currentUser);
    } catch (e) {
      alertError(e.response?.data?.message || "Error deleting user.");
    }
  };

  const openUserModal = (user) => {
    setEditingUser(user);
    setUserDraft({
      name: user.name || "",
      email: user.email || "",
      role: user.role || "user",
      status: user.status || "approved",
    });
    setUserAccessDraft({ ...(getUserAccessOverrides()[user._id] || {}) });
  };

  const closeUserModal = () => {
    setEditingUser(null);
    setUserDraft(null);
  };

  const updateUserAccess = (feature, value) => {
    if (!editingUser) return;
    setUserAccessDraft((draft) => {
      const nextDraft = { ...draft };
      if (value === "default") delete nextDraft[feature];
      else nextDraft[feature] = value;
      const updated = { ...getUserAccessOverrides() };
      if (Object.keys(nextDraft).length) updated[editingUser._id] = nextDraft;
      else delete updated[editingUser._id];
      encryptedStorage.setItem(USER_ACCESS_KEY, updated);
      window.dispatchEvent(
        new CustomEvent("wqms:access-settings", { detail: updated }),
      );
      logActivity(
        "Updated user access override",
        { user: editingUser.email, feature, value },
        currentUser,
      );
      return nextDraft;
    });
  };

  const saveUserDetails = async () => {
    if (!editingUser || !userDraft) return;
    setSaving(true);
    try {
      const { data } = await api.patch(
        `/admin/users/${editingUser._id}`,
        userDraft,
      );
      setUsers((prev) => prev.map((u) => (u._id === data._id ? data : u)));
      logActivity("Updated user details", { user: data.email }, currentUser);
      closeUserModal();
      toastSaved("User account updated.");
    } catch (e) {
      alertError(e.response?.data?.message || "Error updating user details.");
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      title: "Account",
      dataIndex: "name",
      key: "name",
      render: (name, record) => (
        <Space>
          <Avatar style={{ background: "#446ACB" }} icon={<UserOutlined />}>
            {name?.charAt(0).toUpperCase()}
          </Avatar>
          <span style={{ display: "grid", lineHeight: 1.3 }}>
            <Space size={6}>
              <strong style={{ fontWeight: 600 }}>{name}</strong>
              {record._id === currentUser._id && (
                <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                  You
                </Tag>
              )}
            </Space>
            <small style={{ color: "var(--text-muted, #6b7280)" }}>
              {record.email}
            </small>
          </span>
        </Space>
      ),
    },
    {
      title: "Role",
      dataIndex: "role",
      key: "role",
      width: 120,
      filters: ROLES.map((r) => ({ text: r, value: r })),
      onFilter: (value, record) => record.role === value,
      render: (role) => (
        <Tag color={ROLE_TAG_COLORS[role] || "default"}>{role}</Tag>
      ),
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 120,
      filters: Object.entries(STATUS_LABELS).map(([value, text]) => ({
        text,
        value,
      })),
      onFilter: (value, record) => (record.status || "approved") === value,
      render: (status) => (
        <Tag color={STATUS_TAG_COLORS[status || "approved"]}>
          {STATUS_LABELS[status || "approved"]}
        </Tag>
      ),
    },
    {
      title: "Created",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 130,
      responsive: ["md"],
      render: (value) =>
        new Date(value).toLocaleDateString("en-PH", {
          year: "numeric",
          month: "short",
          day: "numeric",
        }),
    },
    {
      title: "Actions",
      key: "actions",
      width: 230,
      render: (_, record) => {
        const isPending = (record.status || "approved") === "pending";
        return (
          <Space size={4} wrap>
            {isPending && record._id !== currentUser._id && (
              <>
                <Button
                  size="small"
                  type="primary"
                  icon={<CheckOutlined />}
                  onClick={() => changeStatus(record, "approved")}
                >
                  Approve
                </Button>
                <Button
                  size="small"
                  danger
                  icon={<CloseCircleOutlined />}
                  onClick={() => changeStatus(record, "rejected")}
                >
                  Reject
                </Button>
              </>
            )}
            <Button
              size="small"
              icon={<SettingOutlined />}
              onClick={() => openUserModal(record)}
            >
              Manage
            </Button>
            {record._id !== currentUser._id && (
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() => deleteUser(record)}
              />
            )}
          </Space>
        );
      },
    },
  ];

  if (loading) return <div className="panel-loading">Loading users...</div>;

  const isSelf = editingUser?._id === currentUser._id;

  return (
    <div className="accounts-panel">
      {pendingUsers.length > 0 && (
        <Card
          variant="borderless"
          className="settings-pending-card"
          style={{ marginBottom: 16 }}
          title={
            <Space>
              <Badge count={pendingUsers.length} />
              <TeamOutlined />
              <span>Pending Sign-Up Approvals</span>
            </Space>
          }
        >
          <Space orientation="vertical" size={10} style={{ width: "100%" }}>
            {pendingUsers.map((u) => (
              <div key={u._id} className="settings-pending-row">
                <Space>
                  <Avatar style={{ background: "#f59e0b" }} icon={<UserOutlined />}>
                    {u.name?.charAt(0).toUpperCase()}
                  </Avatar>
                  <span style={{ display: "grid", lineHeight: 1.3 }}>
                    <strong style={{ fontWeight: 600 }}>{u.name}</strong>
                    <small style={{ color: "var(--text-muted, #6b7280)" }}>
                      {u.email}
                    </small>
                  </span>
                </Space>
                <Space>
                  <Button
                    type="primary"
                    size="small"
                    icon={<CheckOutlined />}
                    onClick={() => changeStatus(u, "approved")}
                  >
                    Approve
                  </Button>
                  <Button
                    danger
                    size="small"
                    icon={<CloseCircleOutlined />}
                    onClick={() => changeStatus(u, "rejected")}
                  >
                    Reject
                  </Button>
                </Space>
              </div>
            ))}
          </Space>
        </Card>
      )}

      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <Input.Search
          allowClear
          placeholder="Search by name, email, or role"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 320 }}
        />
        <Space wrap>
          <Tag color="blue">{users.length} accounts</Tag>
          {pendingUsers.length > 0 && (
            <Tag color="gold">{pendingUsers.length} pending</Tag>
          )}
          <Button
            icon={<SafetyOutlined />}
            onClick={() => setAccessOpen(true)}
          >
            Global Access Settings
          </Button>
        </Space>
      </div>

      <Table
        rowKey="_id"
        size="middle"
        columns={columns}
        dataSource={filteredUsers}
        pagination={{ pageSize: 10, showSizeChanger: true }}
        scroll={{ x: "max-content" }}
        rowClassName={(record) =>
          record._id === currentUser._id ? "row-self" : ""
        }
      />

      <ManageAccessModal
        open={accessOpen}
        onClose={() => setAccessOpen(false)}
        currentUser={currentUser}
      />

      <Modal
        open={Boolean(editingUser && userDraft)}
        onCancel={closeUserModal}
        title={
          <Space>
            <UserOutlined />
            <span>Manage User Account</span>
          </Space>
        }
        okText="Save Changes"
        confirmLoading={saving}
        onOk={saveUserDetails}
        width={620}
        destroyOnClose
      >
        {userDraft && (
          <Form layout="vertical" style={{ marginTop: 8 }}>
            <Row gutter={12}>
              <Col xs={24} sm={12}>
                <Form.Item label="Name" style={{ marginBottom: 12 }}>
                  <Input
                    value={userDraft.name}
                    onChange={(e) =>
                      setUserDraft((d) => ({ ...d, name: e.target.value }))
                    }
                  />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item label="Email" style={{ marginBottom: 12 }}>
                  <Input
                    value={userDraft.email}
                    onChange={(e) =>
                      setUserDraft((d) => ({ ...d, email: e.target.value }))
                    }
                  />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item label="Role" style={{ marginBottom: 12 }}>
                  <Select
                    value={userDraft.role}
                    disabled={isSelf}
                    onChange={(value) =>
                      setUserDraft((d) => ({ ...d, role: value }))
                    }
                    options={ROLES.map((r) => ({ value: r, label: r }))}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item label="Status" style={{ marginBottom: 12 }}>
                  <Select
                    value={userDraft.status}
                    disabled={isSelf}
                    onChange={(value) =>
                      setUserDraft((d) => ({ ...d, status: value }))
                    }
                    options={Object.entries(STATUS_LABELS).map(
                      ([value, label]) => ({ value, label }),
                    )}
                  />
                </Form.Item>
              </Col>
            </Row>
            <Divider style={{ margin: "4px 0 14px" }}>
              <SafetyOutlined /> Role Access Settings
            </Divider>
            <p
              style={{
                marginTop: 0,
                fontSize: 12,
                color: "var(--text-muted, #6b7280)",
              }}
            >
              Toggle access to each app area for this account. Changes apply
              immediately. A switch on its role default shows a{" "}
              <Tag style={{ marginInlineEnd: 0 }}>Default</Tag> badge — use{" "}
              <strong>Reset</strong> to follow the global rule again.
            </p>
            <div className="settings-access-toggle-list">
              {ACCESS_FEATURES.map(([key, label]) => {
                const override = userAccessDraft[key];
                const isOverridden = override === "allow" || override === "deny";
                const checked = isOverridden
                  ? override === "allow"
                  : isDefaultFeatureAllowed(key, userDraft.role);
                return (
                  <div key={key} className="settings-access-toggle-row">
                    <div className="settings-access-toggle-label">
                      <span>{label}</span>
                      {!isOverridden && (
                        <Tag bordered={false} color="default">
                          Default
                        </Tag>
                      )}
                    </div>
                    <Space size={8}>
                      {isOverridden && (
                        <Button
                          type="link"
                          size="small"
                          onClick={() => updateUserAccess(key, "default")}
                          style={{ paddingInline: 0 }}
                        >
                          Reset
                        </Button>
                      )}
                      <Switch
                        checked={checked}
                        checkedChildren={<CheckOutlined />}
                        unCheckedChildren={<CloseCircleOutlined />}
                        onChange={(value) =>
                          updateUserAccess(key, value ? "allow" : "deny")
                        }
                      />
                    </Space>
                  </div>
                );
              })}
            </div>
          </Form>
        )}
      </Modal>
    </div>
  );
};

const EmailPanel = () => {
  const [testEmail, setTestEmail] = useState("");
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  const sendTest = async () => {
    if (!testEmail) return;
    setLoading(true);
    setStatus(null);
    try {
      await api.post("/auth/forgot-password", { email: testEmail });
      setStatus({ type: "success", text: "Test email sent if the address exists." });
    } catch {
      setStatus({
        type: "error",
        text: "Failed to send test email. Check Gmail SMTP configuration.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card
      variant="borderless"
      title={
        <Space>
          <MailOutlined />
          <span>Email Configuration</span>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 14 }}
        title="Emails are sent via Gmail SMTP using the App Password configured in the server environment."
      />
      <Descriptions
        column={1}
        size="small"
        style={{ marginBottom: 14 }}
        items={[
          {
            key: "sender",
            label: "Configured sender",
            children: <code>emb.vera.ember@gmail.com</code>,
          },
        ]}
      />
      <Space.Compact style={{ width: "100%", maxWidth: 480 }}>
        <Input
          type="email"
          placeholder="Send test reset email to..."
          value={testEmail}
          onChange={(e) => setTestEmail(e.target.value)}
          prefix={<MailOutlined />}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={sendTest}
          loading={loading}
          disabled={!testEmail}
        >
          Send Test
        </Button>
      </Space.Compact>
      {status && (
        <Alert
          type={status.type}
          showIcon
          style={{ marginTop: 12 }}
          title={status.text}
        />
      )}
    </Card>
  );
};

const LOG_ACTION_COLORS = {
  default: "blue",
};

const LogsPanel = ({ user }) => {
  const [logs, setLogs] = useState(getAppLogs());
  const actionData = useMemo(() => {
    const counts = logs.reduce((acc, log) => {
      acc[log.action] = (acc[log.action] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(counts)
      .slice(0, 6)
      .map(([name, value]) => ({ name, value }));
  }, [logs]);

  useEffect(() => {
    const refresh = () => setLogs(getAppLogs());
    window.addEventListener("wqms:log", refresh);
    return () => window.removeEventListener("wqms:log", refresh);
  }, []);

  const exportLogs = () => {
    const blob = new Blob([JSON.stringify(logs, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `wqms_app_logs_${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const clearLogs = async () => {
    const confirmed = await confirmAction({
      title: "Clear all app logs?",
      text: "This permanently removes all locally stored activity logs.",
      confirmButtonText: "Yes, clear",
      danger: true,
    });
    if (!confirmed) return;
    clearAppLogs();
    logActivity("Cleared app logs", {}, user);
    setLogs(getAppLogs());
    toastSaved("App logs cleared.");
  };

  const columns = [
    {
      title: "Time",
      dataIndex: "at",
      key: "at",
      width: 180,
      render: (value) => new Date(value).toLocaleString("en-PH"),
    },
    {
      title: "Actor",
      dataIndex: "actor",
      key: "actor",
      width: 200,
      render: (actor, record) => (
        <Space size={6}>
          <span>{actor}</span>
          <Tag bordered={false}>{record.role}</Tag>
        </Space>
      ),
    },
    {
      title: "Action",
      dataIndex: "action",
      key: "action",
      width: 200,
      render: (action) => (
        <Tag color={LOG_ACTION_COLORS.default}>{action}</Tag>
      ),
    },
    {
      title: "Details",
      dataIndex: "details",
      key: "details",
      render: (details) => (
        <code style={{ fontSize: 11 }}>{JSON.stringify(details || {})}</code>
      ),
    },
  ];

  return (
    <Space orientation="vertical" size="large" style={{ width: "100%" }}>
      <Card
        variant="borderless"
        title={
          <Space>
            <FileTextOutlined />
            <span>Activity Log</span>
            <Tag color="blue">{logs.length} records</Tag>
          </Space>
        }
        extra={
          <Space>
            <Button
              icon={<DownloadOutlined />}
              onClick={exportLogs}
              disabled={!logs.length}
            >
              Export
            </Button>
            <Button
              danger
              icon={<DeleteOutlined />}
              onClick={clearLogs}
              disabled={!logs.length}
            >
              Clear
            </Button>
          </Space>
        }
      >
        {actionData.length > 0 && (
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={actionData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <RechartsTooltip />
              <Bar dataKey="value" fill="#446ACB" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
        <Table
          rowKey="id"
          size="small"
          style={{ marginTop: 12 }}
          columns={columns}
          dataSource={logs}
          scroll={{ x: "max-content" }}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          locale={{ emptyText: "No app activities have been logged yet." }}
        />
      </Card>
    </Space>
  );
};

const BackupPanel = ({ user }) => {
  const [status, setStatus] = useState(null);
  const backupRows = [
    {
      name: "Tabular Drafts",
      value: encryptedStorage.getItem(WQM_DRAFTS_KEY)
        ? "Available"
        : "No local draft",
    },
    { name: "App Logs", value: `${getAppLogs().length} records` },
    {
      name: "Theme Config",
      value: encryptedStorage.getItem("wqm_theme") || "default",
    },
  ];

  const exportBackup = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      app: "EMBR3-WQMS",
      localDrafts: encryptedStorage.getItem(WQM_DRAFTS_KEY),
      appLogs: getAppLogs(),
      theme: encryptedStorage.getItem("wqm_theme"),
      config: {
        basePath: "/water-quality-monitoring",
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `wqms_backup_${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    logActivity(
      "Exported app backup",
      { includes: ["drafts", "logs", "theme", "config"] },
      user,
    );
    setStatus({ type: "success", text: "Backup export generated." });
    toastSaved("Backup export generated.");
  };

  const importBackup = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      if (payload.localDrafts)
        encryptedStorage.setItem(WQM_DRAFTS_KEY, payload.localDrafts);
      if (payload.appLogs)
        encryptedStorage.setItem("wqms_app_logs", payload.appLogs);
      if (payload.theme) encryptedStorage.setItem("wqm_theme", payload.theme);
      logActivity("Imported app backup", { file: file.name }, user);
      setStatus({
        type: "success",
        text: "Backup imported. Refresh the app to reload restored local data.",
      });
      toastSaved("Backup imported.");
    } catch {
      setStatus({ type: "error", text: "Invalid backup file." });
    } finally {
      event.target.value = "";
    }
  };

  return (
    <Card
      variant="borderless"
      title={
        <Space>
          <DatabaseOutlined />
          <span>Local Data Backup</span>
        </Space>
      }
    >
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {backupRows.map((row) => (
          <Col xs={24} sm={8} key={row.name}>
            <Card size="small" variant="borderless" className="settings-stat-card">
              <Statistic title={row.name} value={row.value} />
            </Card>
          </Col>
        ))}
      </Row>
      <Space wrap>
        <Button
          type="primary"
          icon={<DownloadOutlined />}
          onClick={exportBackup}
        >
          Export Backup
        </Button>
        <Button icon={<UploadOutlined />}>
          <label style={{ cursor: "pointer" }}>
            Import Backup
            <input
              type="file"
              accept="application/json"
              onChange={importBackup}
              style={{ display: "none" }}
            />
          </label>
        </Button>
      </Space>
      {status && (
        <Alert
          type={status.type}
          showIcon
          style={{ marginTop: 12 }}
          title={status.text}
        />
      )}
    </Card>
  );
};

const AiForecastPanel = () => {
  const [forecastMonths, setForecastMonths] = useState(getForecastMonths);
  const [savedMonths, setSavedMonths] = useState(false);
  const [localEngineStatus, setLocalEngineStatus] = useState(null);
  const [checkingEngines, setCheckingEngines] = useState(false);
  const [engineMessage, setEngineMessage] = useState("");

  const saveForecastMonths = (val) => {
    const clamped = setForecastMonthsSetting(val);
    setForecastMonths(clamped);
    setSavedMonths(true);
    setTimeout(() => setSavedMonths(false), 2200);
    toastSaved(`Forecast horizon set to ${clamped} month${clamped > 1 ? "s" : ""}.`);
  };

  const checkLocalEngines = useCallback(() => {
    setCheckingEngines(true);
    setEngineMessage("");
    api
      .get("/water/forecast/status")
      .then(({ data }) => {
        setLocalEngineStatus(data);
      })
      .catch((err) => {
        setEngineMessage(
          err.response?.data?.message || "Unable to reach forecast service.",
        );
        setLocalEngineStatus(null);
      })
      .finally(() => setCheckingEngines(false));
  }, []);

  useEffect(() => {
    queueMicrotask(checkLocalEngines);
  }, [checkLocalEngines]);

  const localEngines = localEngineStatus?.localEngines || [];

  const horizonOptions = [
    {
      value: 1,
      label: "1 month ahead",
      desc: "Short-range — highest accuracy",
    },
    {
      value: 2,
      label: "2 months ahead",
      desc: "Mid-range — moderate accuracy",
    },
    { value: 3, label: "3 months ahead", desc: "Long-range — indicative only" },
  ];

  return (
    <Space orientation="vertical" size="large" style={{ width: "100%" }}>
      {/* Forecast Horizon Setting */}
      <Card
        size="small"
        title={
          <Space>
            <SettingOutlined />
            <span>Forecast Horizon</span>
          </Space>
        }
        extra={
          savedMonths && (
            <Tag color="success" icon={<CheckCircleOutlined />}>
              Saved
            </Tag>
          )
        }
      >
        <p
          style={{
            margin: "0 0 12px",
            fontSize: 13,
            color: "var(--text-muted, #6b7280)",
          }}
        >
          Set how many months ahead the AI-assisted Prophet additive model will
          project. This applies to all forecast charts — trend charts, AI
          forecast cards, and tabular forecast panels.
        </p>
        <Segmented
          block
          value={forecastMonths}
          onChange={saveForecastMonths}
          options={horizonOptions.map(({ value, label }) => ({
            value,
            label,
          }))}
        />
        <Row gutter={[8, 8]} style={{ marginTop: 10 }}>
          {horizonOptions.map(({ value, desc }) => (
            <Col xs={24} sm={8} key={value}>
              <div
                style={{
                  fontSize: 11,
                  color:
                    forecastMonths === value
                      ? "#446ACB"
                      : "var(--text-muted, #6b7280)",
                  fontWeight: forecastMonths === value ? 700 : 400,
                  textAlign: "center",
                }}
              >
                {desc}
              </div>
            </Col>
          ))}
        </Row>
        <Alert
          type="info"
          showIcon
          style={{ marginTop: 12 }}
          title={`Currently forecasting ${forecastMonths} month${forecastMonths > 1 ? "s" : ""} ahead. Changes take effect immediately on all forecast charts.`}
        />
      </Card>

      {/* Local Forecast Engine Status */}
      <Card
        size="small"
        title={
          <Space>
            <LineChartOutlined />
            <span>Local Forecast Engines</span>
          </Space>
        }
        extra={
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={checkingEngines}
            onClick={checkLocalEngines}
          >
            Check Status
          </Button>
        }
      >
        <p
          style={{
            margin: "0 0 10px",
            fontSize: 13,
            color: "var(--text-muted, #6b7280)",
          }}
        >
          All forecasts run entirely in-browser using a{" "}
          <strong>Prophet-style additive model</strong> — no API key or external
          service required. Predictions are computed from the published WQM
          dataset using trend decomposition, seasonal patterns, and confidence
          interval estimation.
        </p>
        <Row gutter={[12, 12]}>
          {localEngines.length > 0 ? (
            localEngines.map((engine) => (
              <Col xs={24} sm={12} key={engine.id}>
                <Card
                  size="small"
                  type="inner"
                  title={
                    <Space>
                      <LineChartOutlined />
                      {engine.label}
                    </Space>
                  }
                >
                  <p style={{ margin: 0, fontSize: 12 }}>
                    {engine.description}
                  </p>
                </Card>
              </Col>
            ))
          ) : (
            <Col span={24}>
              <Card size="small" type="inner">
                <Space>
                  <CheckCircleOutlined style={{ color: "#16a34a" }} />
                  <div>
                    <strong>Prophet Additive Engine</strong>
                    <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>
                      Runs in-browser. Decomposes trend, seasonal, and residual
                      components. Outputs F1–F{forecastMonths} forecast with
                      confidence band.
                    </p>
                  </div>
                </Space>
              </Card>
            </Col>
          )}
        </Row>
        {engineMessage && (
          <Alert
            type="warning"
            showIcon
            title={engineMessage}
            style={{ marginTop: 10 }}
          />
        )}
      </Card>

      {/* How it works */}
      <Card size="small" title="How the forecast works">
        <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <Tag color="blue" style={{ flex: "0 0 auto", marginTop: 1 }}>
              1
            </Tag>
            <span>
              <strong>Data input:</strong> Monthly readings per station per
              parameter from the published WQM dataset are extracted as a time
              series.
            </span>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <Tag color="blue" style={{ flex: "0 0 auto", marginTop: 1 }}>
              2
            </Tag>
            <span>
              <strong>Decomposition:</strong> A linear trend and sinusoidal
              seasonal component are fitted to the observed series using
              ordinary least squares.
            </span>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <Tag color="blue" style={{ flex: "0 0 auto", marginTop: 1 }}>
              3
            </Tag>
            <span>
              <strong>Projection:</strong> The fitted model is extended{" "}
              {forecastMonths} month{forecastMonths > 1 ? "s" : ""} forward.
              Confidence bands widen with each step to reflect increasing
              uncertainty.
            </span>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <Tag color="gold" style={{ flex: "0 0 auto", marginTop: 1 }}>
              Note
            </Tag>
            <span>
              Forecasts are <strong>indicative projections</strong> for review
              support only — not official predictions. Reviewer judgment and
              current field conditions always take priority.
            </span>
          </div>
        </div>
      </Card>
    </Space>
  );
};

const LCM_PREVIEW_COLORS = [
  "#446ACB",
  "#7CB675",
  "#e07b54",
  "#a78bfa",
  "#f59e0b",
  "#06b6d4",
];

const LineChartMergePanel = ({ currentUser }) => {
  const sheets = useWqmSheets();
  const canManage = ["admin", "developer"].includes(currentUser?.role);

  const initial = getLineChartMergeSettings();
  const [draftEnabled, setDraftEnabled] = useState(initial.includeHistoricalYears);
  const [draftYears, setDraftYears] = useState(
    Array.isArray(initial.historicalYears) ? initial.historicalYears : [],
  );
  const [savedEnabled, setSavedEnabled] = useState(initial.includeHistoricalYears);
  const [savedYears, setSavedYears] = useState(
    Array.isArray(initial.historicalYears) ? initial.historicalYears : [],
  );

  // Historical year options are all available years except the published year
  // (2026 is always included when enabled — no point making it a checkbox).
  const historicalOptions = WQM_YEAR_OPTIONS.filter((y) => y !== 2026);

  const toggleYear = (yr) => {
    setDraftYears((prev) =>
      prev.includes(yr) ? prev.filter((y) => y !== yr) : [...prev, yr],
    );
  };

  // All years for the preview: selected historical + 2026
  const previewYears = useMemo(() => {
    if (!draftEnabled || !draftYears.length) return [2026];
    const sorted = [...draftYears].sort((a, b) => a - b);
    return sorted.includes(2026) ? sorted : [...sorted, 2026];
  }, [draftEnabled, draftYears]);

  const { map: previewSheetsMap, loading: previewLoading } = useAllYearSheets(previewYears);

  // Pick a representative waterbody + param for the preview chart. When past
  // years are included, prefer a waterbody/parameter that actually has data in
  // multiple of the selected years so the preview visibly spans those years.
  const previewMeta = useMemo(() => {
    const options = buildWaterbodyOptions(sheets);
    const hasMonthly = (yr, key, param) => {
      const yrSheets = previewSheetsMap.get(yr) || [];
      const sheet = yrSheets.find((s) => s.key === key);
      const stations = getReadableStations(sheet);
      return stations.some((station) =>
        MONTHS_SHORT.some(
          (_, index) => getMonthlyNumber(getParamData(station, param), index) !== null,
        ),
      );
    };

    if (draftEnabled && draftYears.length) {
      let best = null;
      for (const waterbody of options) {
        const sheet = sheets.find((item) => item.key === waterbody.key);
        const stations = getReadableStations(sheet);
        const params = getAvailableParams(stations, false);
        for (const param of params) {
          const coverage = previewYears.filter((yr) => hasMonthly(yr, waterbody.key, param)).length;
          if (coverage >= 2 && (!best || coverage > best.coverage)) {
            best = { waterbodyKey: waterbody.key, name: waterbody.name, param, coverage };
            if (coverage === previewYears.length) return best;
          }
        }
      }
      if (best) return best;
    }

    // Fallback: first waterbody/param with current-year monthly data.
    for (const waterbody of options) {
      const sheet = sheets.find((item) => item.key === waterbody.key);
      const stations = getReadableStations(sheet);
      const params = getAvailableParams(stations, false);
      const param = params.find((candidate) =>
        stations.some((station) =>
          MONTHS_SHORT.some(
            (_, index) => getMonthlyNumber(getParamData(station, candidate), index) !== null,
          ),
        ),
      );
      if (param) return { waterbodyKey: waterbody.key, name: waterbody.name, param };
    }
    return null;
  }, [sheets, draftEnabled, draftYears, previewYears, previewSheetsMap]);

  const previewData = useMemo(() => {
    if (!previewMeta) return [];
    if (!draftEnabled) {
      // Single-year: per-station lines for 2026
      const sheet = sheets.find((s) => s.key === previewMeta.waterbodyKey);
      const stations = getReadableStations(sheet);
      const stationKeys = stations.map((stn, i) => ({
        station: stn,
        key: `s${i}`,
        color: LCM_PREVIEW_COLORS[i % LCM_PREVIEW_COLORS.length],
      }));
      return {
        mode: "per-station",
        points: MONTHS_SHORT.map((label, mi) => {
          const point = { label };
          stationKeys.forEach(({ station, key }) => {
            point[key] = getMonthlyNumber(getParamData(station, previewMeta.param), mi);
          });
          return point;
        }),
        stationKeys,
      };
    }
    // Multi-year: single merged line
    return {
      mode: "multi-year",
      points: buildMultiYearTrend(
        previewSheetsMap,
        previewYears,
        previewMeta.waterbodyKey,
        previewMeta.param,
        MONTHS_SHORT,
        getParamData,
        getMonthlyNumber,
        getReadableStations,
      ),
    };
  }, [draftEnabled, draftYears, previewMeta, previewSheetsMap, previewYears, sheets]);

  const dirty =
    draftEnabled !== savedEnabled ||
    JSON.stringify([...draftYears].sort()) !== JSON.stringify([...savedYears].sort());

  const handleSave = () => {
    setLineChartMergeSettings({
      includeHistoricalYears: draftEnabled,
      historicalYears: draftYears,
    });
    setSavedEnabled(draftEnabled);
    setSavedYears([...draftYears]);
    logActivity("Updated line chart historical data setting", {
      includeHistoricalYears: draftEnabled,
      historicalYears: draftYears,
    }, currentUser);
    toastSaved(
      draftEnabled && draftYears.length
        ? `Historical data enabled: ${[...draftYears].sort((a, b) => a - b).join(", ")} + 2026 will now appear on all line charts.`
        : "Line charts will show the current published year only.",
    );
  };

  if (!canManage) {
    return (
      <Alert
        type="info"
        showIcon
        message="Developer or administrator access required"
        description="Only developers and administrators can change the historical data settings for line charts."
      />
    );
  }

  return (
    <div className="linechart-merge-panel">
      {/* ── Feature toggle ── */}
      <div className="lcm-row">
        <div>
          <strong>Include historical years in line charts</strong>
          <p className="section-desc" style={{ margin: "0.25rem 0 0" }}>
            When enabled, monthly readings from past years are stitched together
            with the current year so every line chart (the Dashboard monthly
            trend and Waterbody Profile trend) shows a continuous multi-year
            trend instead of a single year. This makes it easy to see whether
            parameter levels are improving, declining, or staying stable over
            multiple monitoring cycles.
          </p>
        </div>
        <Switch
          checked={draftEnabled}
          onChange={setDraftEnabled}
          checkedChildren="Multi-year"
          unCheckedChildren="Single year"
        />
      </div>

      {/* ── Year selector ── */}
      {draftEnabled && (
        <div className="lcm-year-selector">
          <strong>Which past years to include?</strong>
          <p className="section-desc" style={{ margin: "0.2rem 0 0.6rem" }}>
            The current year (2026) is always included as the latest data.
            Check the years below to extend the trend further back.
          </p>
          <div className="lcm-year-chips">
            {historicalOptions.map((yr) => (
              <button
                key={yr}
                type="button"
                className={`lcm-year-chip${draftYears.includes(yr) ? " selected" : ""}`}
                onClick={() => toggleYear(yr)}
              >
                {yr}
              </button>
            ))}
            <span className="lcm-year-chip always-on" aria-label="2026 is always included">
              2026 ✓
            </span>
          </div>
          {draftEnabled && !draftYears.length && (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 8 }}
              message="Select at least one historical year to extend the trend, or turn off multi-year mode."
            />
          )}
        </div>
      )}

      {/* ── Live preview chart ── */}
      <div className="lcm-preview">
        <div className="lcm-preview-head">
          <strong>
            Preview ·{" "}
            {draftEnabled && draftYears.length
              ? `${[...draftYears].sort((a, b) => a - b).join(", ")} + 2026 merged trend`
              : "Single year (2026)"}
          </strong>
          {previewMeta && (
            <span className="section-desc">
              {previewMeta.name} · {previewMeta.param}
            </span>
          )}
        </div>
        {previewLoading ? (
          <div className="section-desc" style={{ padding: "1.5rem 0" }}>
            Loading historical data for preview…
          </div>
        ) : previewMeta ? (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart
              data={previewData.points}
              margin={{ top: 8, right: 16, left: -8, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 9.5 }}
                interval="preserveStartEnd"
                angle={-28}
                textAnchor="end"
                height={42}
              />
              <YAxis tick={{ fontSize: 11 }} />
              <RechartsTooltip />
              {previewData.mode === "multi-year" ? (
                <Line
                  type="monotone"
                  dataKey="merged"
                  name="Waterbody average"
                  stroke="#446ACB"
                  strokeWidth={2.6}
                  dot={{ r: 2.5 }}
                  connectNulls
                />
              ) : (
                (previewData.stationKeys || []).map(({ station, key, color }) => (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    name={station.stnId}
                    stroke={color}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                ))
              )}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="section-desc">
            No monthly readings are available in the published dataset to
            preview.
          </p>
        )}
      </div>

      {/* ── Actions ── */}
      <div className="lcm-actions">
        <Button
          onClick={() => {
            setDraftEnabled(savedEnabled);
            setDraftYears([...savedYears]);
          }}
          disabled={!dirty}
        >
          Discard changes
        </Button>
        <Button
          type="primary"
          onClick={handleSave}
          disabled={!dirty || (draftEnabled && !draftYears.length)}
        >
          Save &amp; apply to all line charts
        </Button>
      </div>

      {!dirty && savedEnabled && savedYears.length > 0 && (
        <Alert
          type="success"
          showIcon
          style={{ marginTop: 12 }}
          message={`Multi-year trend is active: ${[...savedYears].sort((a, b) => a - b).join(", ")} + 2026 are shown on all line charts.`}
        />
      )}
    </div>
  );
};

const Settings = ({ initialSection = "accounts" }) => {
  const { user } = useAuth();
  const { theme, toggle } = useTheme();
  const active = initialSection;

  if (!["admin", "developer"].includes(user?.role)) {
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
          {(active === "accounts" || active === "approvals") && (
            <section className="settings-section">
              <h3>Account Management</h3>
              <p className="section-desc">
                Manage roles, approval states, access toggles, and
                account-level actions in one place.
              </p>
              <AccountsPanel currentUser={user} />
            </section>
          )}

          {(active === "runtime" || active === "database") && (
            <section className="settings-section">
              <h3>App Runtime &amp; Database Status</h3>
              <p className="section-desc">
                Live server diagnostics, monitoring charts, and MongoDB connection health.
              </p>
              <SystemInfo mode="all" />
            </section>
          )}

          {active === "waterbody-settings" && (
            <section className="settings-section">
              <h3>Waterbody Profiles & Station Locations</h3>
              <p className="section-desc">
                Configure profile labels, location source, and
                station-to-waterbody assignment metadata.
              </p>
              <WaterbodyProfileSettings currentUser={user} />
            </section>
          )}

          {active === "chart-config" && (
            <section className="settings-section">
              <h3>Chart Configuration</h3>
              <p className="section-desc">
                Explore every parameter for a station as a continuous multi-year
                line chart (2024, 2025, and 2026 merged for the same station),
                each with a one-month forecast, interpretation, and a full
                readings table.
              </p>
              <ChartConfiguration />
            </section>
          )}

          {active === "logs" && (
            <section className="settings-section">
              <h3>App Logs</h3>
              <p className="section-desc">
                Track CRUD, exports, account changes, navigation, and backup
                operations.
              </p>
              <LogsPanel user={user} />
            </section>
          )}

          {(active === "backup" ||
            active === "email" ||
            active === "visualization-data") && (
            <section className="settings-section">
              <h3>Backup, Published Data &amp; Email</h3>
              <p className="section-desc">
                Manage the published WQM dataset, export or restore local data,
                and test the Gmail SMTP integration.
              </p>
              <div
                style={{
                  marginBottom: "1.5rem",
                  borderBottom: "1px solid var(--border)",
                  paddingBottom: "1.25rem",
                }}
              >
                <h4
                  style={{
                    margin: "0 0 0.4rem",
                    fontSize: "0.92rem",
                    fontWeight: 700,
                  }}
                >
                  Published WQM Dataset
                </h4>
                <p className="section-desc" style={{ margin: "0 0 0.75rem" }}>
                  Choose which WQM year dashboard, visual analytics, and
                  monitoring should display.
                </p>
                <VisualizationYearSettings currentUser={user} />
              </div>
              <BackupPanel user={user} />
              <div
                style={{
                  marginTop: "1.5rem",
                  borderTop: "1px solid var(--border)",
                  paddingTop: "1.25rem",
                }}
              >
                <h4
                  style={{
                    margin: "0 0 0.4rem",
                    fontSize: "0.92rem",
                    fontWeight: 700,
                  }}
                >
                  Email Configuration
                </h4>
                <p className="section-desc" style={{ margin: "0 0 0.75rem" }}>
                  Test the Gmail SMTP integration.
                </p>
                <EmailPanel />
              </div>
            </section>
          )}

          {active === "ai" && (
            <section className="settings-section">
              <h3>AI Forecast</h3>
              <p className="section-desc">
                Configure forecast horizon and review the local in-browser
                forecast engine status.
              </p>
              <AiForecastPanel />
            </section>
          )}

          {active === "linechart" && (
            <section className="settings-section">
              <h3>Line Chart Data</h3>
              <p className="section-desc">
                Extend line charts across multiple monitoring years so trends
                from 2024 and 2025 are shown alongside the current 2026 data.
                Select the past years you want to include, preview the result,
                and save to apply it to every line chart in the app.
              </p>
              <LineChartMergePanel currentUser={user} />
            </section>
          )}

          {active === "theme" && (
            <section className="settings-section">
              <h3>Theme & Display</h3>
              <p className="section-desc">
                Toggle light or dark mode for the entire app.
              </p>
              <div className="theme-toggle-row">
                <span className="theme-label">
                  {theme === "light" ? "Light Mode" : "Dark Mode"}
                </span>
                <button
                  className={`theme-toggle-btn${theme === "dark" ? " dark" : ""}`}
                  onClick={toggle}
                >
                  <span className="toggle-knob" />
                </button>
              </div>
              <p className="section-note">
                Theme preference is saved in your browser and applied on every
                visit.
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};

export default Settings;

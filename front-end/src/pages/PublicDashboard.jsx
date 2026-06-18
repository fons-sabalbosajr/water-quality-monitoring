import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Collapse,
  Divider,
  Empty,
  Input,
  Layout,
  Menu,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  BarChartOutlined,
  DashboardOutlined,
  DownloadOutlined,
  EnvironmentOutlined,
  EyeOutlined,
  FileExcelOutlined,
  GlobalOutlined,
  InfoCircleOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
  SearchOutlined,
  SunOutlined,
  TableOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RCTooltip,
  XAxis,
  YAxis,
} from "recharts";
import embLogo from "../assets/emblogo.svg";
import bagongPilipinasLogo from "../assets/bagongpilipinaslogo.png";
import { useTheme } from "../context/ThemeContext";
import {
  MONTHS_SHORT,
  PARAM_LIMITS,
  fmt,
  getAvailableParams,
  getAverageNumber,
  getLatestNumber,
  getMonthlyNumber,
  getObservationEntries,
  getParamData,
  getParamStatus,
} from "../utils/wqmData";
import {
  buildWaterbodyOptions,
  getReadableStations,
  groupWaterbodyByProvince,
  usePublishedWqmDataset,
} from "../utils/wqmSheets";
import { loadStationLocationsCached } from "../utils/stationWorkbook";
import { resolveWaterbodyMapLocations } from "../utils/stationGeo";
import { useForecastMonths } from "../utils/forecastSettings";
import "./PublicDashboard.css";

const CesiumStationMap = lazy(() => import("../components/CesiumStationMap"));

const { Sider, Content, Header } = Layout;
const { Title, Text } = Typography;

/* Build antd Select options grouped per province. */
const waterbodyProvinceOptions = (waterbodyOptions) =>
  groupWaterbodyByProvince(waterbodyOptions).map((group) => ({
    label: group.province,
    options: group.items.map((item) => ({ value: item.key, label: item.name })),
  }));

/* ── Design tokens ── */
const CHART_COLORS = [
  "#446ACB",
  "#7CB675",
  "#e07b54",
  "#a78bfa",
  "#f59e0b",
  "#06b6d4",
];
const FC_COLOR = "#f59e0b";
const STATUS_COLOR = {
  safe: "#7CB675",
  watch: "#f59e0b",
  alert: "#ef4444",
  nodata: "#94a3b8",
};
const STATUS_TAG = {
  safe: "success",
  watch: "warning",
  alert: "error",
  nodata: "default",
};
const HEADER_DATE_FORMATTER = new Intl.DateTimeFormat("en-PH", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});
const HEADER_TIME_FORMATTER = new Intl.DateTimeFormat("en-PH", {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

/* ── K-format for large values (chips) ── */
const fmtK = (value) => {
  if (value === null || value === undefined) return '—';
  if (typeof value !== 'number') return String(value);
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value < 10 ? value.toFixed(2) : value.toFixed(1);
};

/* ── Pure helpers ── */
const avg = (values) => {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((s, v) => s + v, 0) / valid.length : null;
};

const getObsMeta = (value) => {
  const t = String(value || "").toLowerCase();
  if (/dead|kill|oil|grease|sewage|garbage|foam|foul|odor|black/.test(t))
    return { color: "error", label: "Critical" };
  if (/high\s*tide|low\s*tide|flood|turbid|muddy|rain|construction/.test(t))
    return { color: "warning", label: "Watch" };
  if (/boat|fishing|vessel|banca/.test(t))
    return { color: "default", label: "Activity" };
  if (/clear|normal|good|stable|none/.test(t))
    return { color: "success", label: "Good" };
  return { color: "default", label: "Noted" };
};

const limitLabel = (param) => {
  const l = PARAM_LIMITS[param];
  if (!l) return null;
  if (l.min !== undefined && l.max !== undefined)
    return `${l.min}–${l.max} ${l.unit}`;
  if (l.min !== undefined) return `≥ ${l.min} ${l.unit}`;
  if (l.max !== undefined) return `≤ ${l.max} ${l.unit}`;
  return null;
};

const getForecastParamLabel = (param) => {
  const labels = {
    "DO": "Dissolve Oxygen (DO)",
    "DO (mg/L)": "Dissolve Oxygen (DO)",
    "BOD": "Biochemical Oxygen Demand (BOD)",
    "BOD (mg/L)": "Biochemical Oxygen Demand (BOD)",
    "TSS": "Total Suspended Solids (TSS)",
    "TSS (mg/L)": "Total Suspended Solids (TSS)",
    "pH": "pH Level",
    "Temp.": "Temperature",
    "Temp. (°C)": "Temperature",
    "Color": "Color",
    "Color (TCU)": "Color",
    "Fecal Coliform": "Fecal Coliform",
    "NO3-N": "Nitrates (N03-N)",
    "NO3-N (mg/L)": "Nitrates (N03-N)",
    "PO4-P": "Phospates (P04-P)",
    "PO4-P (mg/L)": "Phospates (P04-P)",
    "Cl-": "Chlorides (Cl)",
    "Cl- (mg/L)": "Chlorides (Cl)",
  };
  const base = labels[param] || param.replace(/ \(.*?\)/, "");
  const unit = PARAM_LIMITS[param]?.unit || "";
  return unit ? `${base} (${unit})` : base;
};

/* ── Prophet-style additive forecast ── */
const buildForecast = (observed, horizonMonths = 3) => {
  if (observed.length < 3) {
    return {
      data: observed,
      points: [],
      diagnostics: {
        confidence: 0,
        trend: "insufficient data",
        rmse: "0",
        slope: "0",
      },
    };
  }
  const indexed = observed.map((pt, i) => ({ x: i, y: pt.actual }));
  const xMean = avg(indexed.map((pt) => pt.x));
  const yMean = avg(indexed.map((pt) => pt.y));
  const denom = indexed.reduce((s, pt) => s + (pt.x - xMean) ** 2, 0);
  const slope = denom
    ? indexed.reduce((s, pt) => s + (pt.x - xMean) * (pt.y - yMean), 0) / denom
    : 0;
  const intercept = yMean - slope * xMean;
  const trendAt = (x) => slope * x + intercept;
  const detrended = indexed.map((pt) => pt.y - trendAt(pt.x));
  const period = Math.min(12, Math.max(4, indexed.length));
  const w = (2 * Math.PI) / period;
  let scc = 0;
  let sss = 0;
  let scs = 0;
  let rc = 0;
  let rs = 0;
  detrended.forEach((r, t) => {
    const c = Math.cos(w * t);
    const si = Math.sin(w * t);
    scc += c * c;
    sss += si * si;
    scs += c * si;
    rc += r * c;
    rs += r * si;
  });
  const det = scc * sss - scs * scs;
  const a = det ? (rc * sss - rs * scs) / det : 0;
  const b = det ? (rs * scc - rc * scs) / det : 0;
  const seasonalAt = (x) => a * Math.cos(w * x) + b * Math.sin(w * x);
  const residuals = indexed.map(
    (pt) => pt.y - (trendAt(pt.x) + seasonalAt(pt.x)),
  );
  const rmse = Math.sqrt(avg(residuals.map((v) => v ** 2)) || 0);
  const latest = observed.at(-1)?.actual ?? null;
  const scale = Math.max(Math.abs(latest || 0), 1);
  const seasonalAmp = Math.sqrt(a * a + b * b);
  const confidence = Math.max(48, Math.min(96, 95 - (rmse / scale) * 100));
  const trend =
    Math.abs(slope) < 0.01 ? "stable" : slope > 0 ? "increasing" : "decreasing";
  const points = Array.from({ length: horizonMonths }, (_, i) => {
    const x = indexed.length + i;
    const forecast = Number((trendAt(x) + seasonalAt(x)).toFixed(4));
    const band = rmse * (1.28 + i * 0.25) + seasonalAmp * 0.25;
    return {
      month: `F${i + 1}`,
      forecast,
      lower: Number((forecast - band).toFixed(4)),
      upper: Number((forecast + band).toFixed(4)),
      confidence: Math.round(Math.max(35, confidence - i * 5)),
    };
  });
  const bridged = observed.map((pt, i) =>
    i === observed.length - 1
      ? { ...pt, forecast: pt.actual, lower: pt.actual, upper: pt.actual }
      : pt,
  );
  return {
    data: [...bridged, ...points],
    points,
    diagnostics: {
      confidence: Math.round(confidence),
      trend,
      rmse: rmse.toFixed(4),
      slope: slope.toFixed(4),
    },
  };
};

/* ── Blob download ── */
const downloadBlob = (content, filename, mime) => {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

/* ── Excel CSV builder — selected waterbody ── */
const buildExcelCsv = (selectedName, waterbodyKey, year, stations, params) => {
  const BOM = "\uFEFF";
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [];
  lines.push(esc("EMB Region III \u2014 Water Quality Monitoring System"));
  lines.push(`${esc("Waterbody")},${esc(selectedName)}`);
  lines.push(`${esc("Key")},${esc(waterbodyKey)}`);
  lines.push(`${esc("Data Year")},${esc(year)}`);
  lines.push(
    `${esc("Export Date")},${esc(new Date().toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" }))}`,
  );
  lines.push(`${esc("Stations")},${esc(stations.length)}`);
  lines.push(`${esc("Parameters")},${esc(params.length)}`);
  lines.push("");
  lines.push(esc("MONITORING STATIONS"));
  lines.push(`${esc("No.")},${esc("Station ID")}`);
  stations.forEach((stn, i) => lines.push(`${i + 1},${esc(stn.stnId)}`));
  lines.push("");
  lines.push(esc("PARAMETER STANDARDS"));
  lines.push(
    [
      esc("Parameter"),
      esc("Unit"),
      esc("Min"),
      esc("Max"),
      esc("Standard"),
    ].join(","),
  );
  params.forEach((param) => {
    const l = PARAM_LIMITS[param];
    lines.push(
      l
        ? [
            esc(param),
            esc(l.unit || "\u2014"),
            l.min ?? "\u2014",
            l.max ?? "\u2014",
            esc(
              l.min ? `\u2265 ${l.min}` : l.max ? `\u2264 ${l.max}` : "Range",
            ),
          ].join(",")
        : [
            esc(param),
            "\u2014",
            "\u2014",
            "\u2014",
            esc("No standard defined"),
          ].join(","),
    );
  });
  lines.push("");
  lines.push(esc("MONTHLY READINGS BY PARAMETER"));
  params.forEach((param) => {
    lines.push("");
    const l = PARAM_LIMITS[param];
    const std = l
      ? l.min
        ? `Min: ${l.min} ${l.unit || ""}`
        : `Max: ${l.max} ${l.unit || ""}`
      : "No standard";
    lines.push(esc(`Parameter: ${param} \u2014 ${std}`));
    lines.push(
      [
        esc("Station"),
        ...MONTHS_SHORT.map(esc),
        esc("Annual Avg"),
        esc("Latest"),
        esc("Status"),
      ].join(","),
    );
    stations.forEach((stn) => {
      const pd = getParamData(stn, param);
      const monthly = MONTHS_SHORT.map((_, i) => {
        const v = getMonthlyNumber(pd, i);
        return v !== null ? v : "";
      });
      const annualVals = monthly.filter(
        (v) => v !== "" && Number.isFinite(Number(v)),
      );
      const annualAvg = annualVals.length
        ? (
            annualVals.reduce((s, v) => s + Number(v), 0) / annualVals.length
          ).toFixed(3)
        : "";
      const latest = getLatestNumber(pd);
      const st = getParamStatus(param, latest);
      const stLabel =
        st === "alert"
          ? "EXCEEDED"
          : st === "watch"
            ? "NEAR LIMIT"
            : st === "safe"
              ? "PASS"
              : "\u2014";
      lines.push(
        [
          esc(stn.stnId),
          ...monthly,
          annualAvg,
          latest !== null ? latest : "",
          esc(stLabel),
        ].join(","),
      );
    });
  });
  lines.push("");
  lines.push(esc("--- End of Export ---"));
  return BOM + lines.join("\n");
};

/* ── Excel CSV builder — all waterbodies ── */
const buildAllExcelCsv = (year, sheets) => {
  const BOM = "\uFEFF";
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [];
  lines.push(
    esc(
      "EMB Region III \u2014 Water Quality Monitoring System \u2014 All Waterbodies",
    ),
  );
  lines.push(`${esc("Data Year")},${esc(year)}`);
  lines.push(
    `${esc("Export Date")},${esc(new Date().toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" }))}`,
  );
  lines.push(`${esc("Total Waterbodies")},${esc(sheets.length)}`);
  lines.push("");
  lines.push(
    [
      esc("Waterbody"),
      esc("Station"),
      esc("Parameter"),
      ...MONTHS_SHORT.map(esc),
      esc("Annual Avg"),
      esc("Latest"),
      esc("Status"),
    ].join(","),
  );
  sheets.forEach((s) => {
    const stns = getReadableStations(s);
    const sParams = getAvailableParams(stns, false);
    stns.forEach((stn) => {
      sParams.forEach((param) => {
        const pd = getParamData(stn, param);
        const monthly = MONTHS_SHORT.map((_, i) => {
          const v = getMonthlyNumber(pd, i);
          return v !== null ? v : "";
        });
        const annualVals = monthly.filter(
          (v) => v !== "" && Number.isFinite(Number(v)),
        );
        const annualAvg = annualVals.length
          ? (
              annualVals.reduce((sum, v) => sum + Number(v), 0) /
              annualVals.length
            ).toFixed(3)
          : "";
        const latest = getLatestNumber(pd);
        const st = getParamStatus(param, latest);
        const stLabel =
          st === "alert"
            ? "EXCEEDED"
            : st === "watch"
              ? "NEAR LIMIT"
              : st === "safe"
                ? "PASS"
                : "\u2014";
        if (monthly.some((v) => v !== "")) {
          lines.push(
            [
              esc(s.name),
              esc(stn.stnId),
              esc(param),
              ...monthly,
              annualAvg,
              latest !== null ? latest : "",
              esc(stLabel),
            ].join(","),
          );
        }
      });
    });
  });
  return BOM + lines.join("\n");
};

/* ─────────────────────────────────────
   REQUEST REMINDER MODAL (shared)
───────────────────────────────────── */
const RequestReminderModal = ({ open, onConfirm, onCancel }) => (
  <Modal
    open={open}
    title={
      <Space>
        <InfoCircleOutlined style={{ color: "#f59e0b" }} />
        <span>Data Access Request Required</span>
      </Space>
    }
    // okText="I Understand — Proceed to Download"
    footer={(_, { OkBtn }) => <OkBtn />}
    onOk={onCancel}
    onCancel={onCancel}
    okButtonProps={{ type: "primary" }}
    width={480}
  >
    <Alert
      type="warning"
      showIcon
      style={{ marginBottom: 14 }}
      title={
        <span>
          <strong>Important:</strong> Downloading water quality data requires a
          formal data request to EMB Region III.
        </span>
      }
    />
    <p style={{ margin: 0, fontSize: 13 }}>
      Please submit your data access request at{" "}
      <a href="https://r3.emb.gov.ph" target="_blank" rel="noreferrer">
        r3.emb.gov.ph
      </a>{" "}
      before proceeding.
    </p>
  </Modal>
);

/* ─────────────────────────────────────
   FORECAST DETAIL MODAL (shared)
───────────────────────────────────── */
const ForecastDetailModal = ({ card, stations, open, onClose }) => {
  const [requestOpen, setRequestOpen] = useState(false);
  const [pendingExport, setPendingExport] = useState(null);

  if (!card) return null;

  const unit = PARAM_LIMITS[card.param]?.unit || "";
  const lbl = limitLabel(card.param);

  /* Build monthly table for every station */
  const tableData = stations.map((stn, idx) => {
    const row = { key: `fd-${idx}`, stnId: stn.stnId };
    MONTHS_SHORT.forEach((_, mi) => {
      row[`m${mi}`] = getMonthlyNumber(getParamData(stn, card.param), mi);
    });
    const vals = MONTHS_SHORT.map((_, mi) => row[`m${mi}`]).filter(Number.isFinite);
    row.avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    return row;
  });

  const cols = [
    {
      title: "Station", dataIndex: "stnId", key: "stnId", fixed: "left", width: 110,
      render: (v) => <Text strong style={{ fontSize: 12 }}>{v}</Text>,
    },
    ...MONTHS_SHORT.map((month, mi) => ({
      title: <span style={{ fontSize: 11 }}>{month}</span>,
      dataIndex: `m${mi}`, key: `m${mi}`, width: 60, align: "center",
      render: (val) => {
        if (val === null || val === undefined) return <Text type="secondary" style={{ fontSize: 11 }}>—</Text>;
        const status = getParamStatus(card.param, val);
        return <span style={{ color: STATUS_COLOR[status], fontWeight: 700, fontSize: 11 }}>{fmt(val)}</span>;
      },
    })),
    {
      title: <span style={{ fontSize: 11 }}>Avg</span>,
      dataIndex: "avg", key: "avg", fixed: "right", width: 70, align: "center",
      render: (val) => {
        if (val === null || val === undefined) return <Text type="secondary" style={{ fontSize: 11 }}>—</Text>;
        const status = getParamStatus(card.param, val);
        return <Tag color={STATUS_TAG[status]} style={{ fontSize: 11, fontWeight: 700 }}>{fmt(val)}</Tag>;
      },
    },
  ];

  const doExport = () => {
    const BOM = "\uFEFF";
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const std = lbl ? `Std: ${lbl}` : "No standard";
    const lines = [
      esc(`EMB Region III — WQMS Parameter Detail`),
      `${esc("Parameter")},${esc(card.param)}`,
      `${esc("Standard")},${esc(std)}`,
      `${esc("Unit")},${esc(unit || "—")}`,
      "",
      [esc("Station"), ...MONTHS_SHORT.map(esc), esc("Annual Avg"), esc("Status")].join(","),
    ];
    tableData.forEach((row) => {
      const monthly = MONTHS_SHORT.map((_, mi) => row[`m${mi}`] ?? "");
      const st = getParamStatus(card.param, row.avg);
      const stLabel = st === "alert" ? "EXCEEDED" : st === "watch" ? "NEAR LIMIT" : st === "safe" ? "PASS" : "—";
      lines.push([esc(row.stnId), ...monthly, row.avg != null ? fmt(row.avg) : "", esc(stLabel)].join(","));
    });
    const blob = new Blob([BOM + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `WQMS_${card.param.replace(/[^\w]/g, "_")}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportClick = () => {
    setPendingExport(true);
    setRequestOpen(true);
  };

  return (
    <>
      <Modal
        open={open}
        onCancel={onClose}
        title={
          <Space>
            <ThunderboltOutlined style={{ color: FC_COLOR }} />
            <span>{getForecastParamLabel(card.param)}</span>
            {lbl && <Tag style={{ fontSize: 11 }}>Std: {lbl}</Tag>}
          </Space>
        }
        width={1000}
        footer={
          <Space>
            <Button icon={<DownloadOutlined />} onClick={handleExportClick}>
              Export CSV
            </Button>
            <Button onClick={onClose}>Close</Button>
          </Space>
        }
      >
        <Space wrap style={{ marginBottom: 12 }}>
          <Tag color={card.diagnostics?.trend === "increasing" ? "error" : card.diagnostics?.trend === "decreasing" ? "success" : "default"}>
            Trend: {card.diagnostics?.trend}
          </Tag>
          <Tag color="gold">Confidence: {card.diagnostics?.confidence}%</Tag>
          <Tag>RMSE: {card.diagnostics?.rmse}</Tag>
          <Tag>Slope: {card.diagnostics?.slope}</Tag>
        </Space>

        <ForecastMiniChart card={card} colorIdx={card.colorIdx} height={200} />

        <div className="pub-fc-points" style={{ margin: "10px 0 14px" }}>
          {card.points.map((pt) => (
            <span key={pt.month} className="pub-fc-point-badge">
              <span className="pub-fc-point-month">{pt.month}</span>
              <span className="pub-fc-point-val">{fmt(pt.forecast)}</span>
              {unit && <em style={{ fontSize: 9, color: "var(--pub-muted)", fontStyle: "normal", marginLeft: 1 }}>{unit}</em>}
            </span>
          ))}
        </div>

        <Divider titlePlacement="left" style={{ margin: "0 0 10px", fontSize: 12, fontWeight: 700 }}>
          Monthly Readings by Station
        </Divider>
        <Table
          columns={cols}
          dataSource={tableData}
          size="small"
          scroll={{ x: "max-content" }}
          pagination={false}
          className="pub-table"
        />
      </Modal>

      <RequestReminderModal
        open={requestOpen}
        onConfirm={() => { setRequestOpen(false); if (pendingExport) doExport(); setPendingExport(null); }}
        onCancel={() => { setRequestOpen(false); setPendingExport(null); }}
      />
    </>
  );
};

/* ─────────────────────────────────────
   FORECAST MINI CHART (shared)
───────────────────────────────────── */
const ForecastMiniChart = ({ card, colorIdx, height = 160 }) => {
  const color = CHART_COLORS[colorIdx % CHART_COLORS.length];
  const lim = PARAM_LIMITS[card.param];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={card.data}
        margin={{ top: 6, right: 6, bottom: 0, left: -14 }}
      >
        <defs>
          <linearGradient id={`fmcObs${colorIdx}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id={`fmcBand${colorIdx}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={FC_COLOR} stopOpacity={0.2} />
            <stop offset="100%" stopColor={FC_COLOR} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--pub-border)" />
        <XAxis dataKey="month" tick={{ fontSize: 9 }} />
        <YAxis tick={{ fontSize: 9 }} />
        <RCTooltip
          contentStyle={{
            background: "var(--pub-tooltip-bg)",
            border: "1px solid var(--pub-border)",
            borderRadius: 8,
            fontSize: 11,
          }}
        />
        {lim?.min !== undefined && (
          <ReferenceLine
            y={lim.min}
            stroke="#ef4444"
            strokeDasharray="5 3"
            strokeWidth={1.5}
            label={{ value: `${lim.min}`, position: 'insideBottomRight', fontSize: 8, fill: '#ef4444', fontWeight: 700 }}
          />
        )}
        {lim?.max !== undefined && (
          <ReferenceLine
            y={lim.max}
            stroke="#ef4444"
            strokeDasharray="5 3"
            strokeWidth={1.5}
            label={{ value: `${lim.max}`, position: 'insideTopRight', fontSize: 8, fill: '#ef4444', fontWeight: 700 }}
          />
        )}
        <Area
          type="monotone"
          dataKey="actual"
          name="Observed"
          stroke={color}
          fill={`url(#fmcObs${colorIdx})`}
          strokeWidth={2}
          connectNulls
          dot={{ r: 2.5, fill: color }}
        />
        <Area
          type="monotone"
          dataKey="upper"
          legendType="none"
          stroke="none"
          fill={`url(#fmcBand${colorIdx})`}
          fillOpacity={1}
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="forecast"
          name="AI Forecast"
          stroke={FC_COLOR}
          strokeDasharray="5 3"
          strokeWidth={2}
          connectNulls
          dot={{
            r: 5,
            fill: FC_COLOR,
            stroke: "#fff",
            strokeWidth: 1.5,
            className: "pub-fc-dot",
          }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
};

/* ─────────────────────────────────────
   DASHBOARD VIEW
───────────────────────────────────── */
const DashboardView = ({
  sheets,
  waterbodyKey,
  setWaterbodyKey,
  waterbodyOptions,
  stationLocations,
  year,
  loading,
  error,
}) => {
  const sheet = sheets.find((s) => s.key === waterbodyKey);
  const stations = useMemo(() => getReadableStations(sheet), [sheet]);
  const params = useMemo(() => getAvailableParams(stations, false), [stations]);
  const [chartParam, setChartParam] = useState("");
  const [forecastStnId, setForecastStnId] = useState("");
  // Reactive forecast horizon — applies admin changes immediately.
  const forecastMonths = useForecastMonths();

  const chartParams = useMemo(
    () =>
      params.filter((p) =>
        stations.some((stn) =>
          MONTHS_SHORT.some(
            (_, i) => getMonthlyNumber(getParamData(stn, p), i) !== null,
          ),
        ),
      ),
    [params, stations],
  );
  const activeChartParam = chartParams.includes(chartParam)
    ? chartParam
    : chartParams[0] || "";

  let currentMonthIdx = -1;
  for (let i = MONTHS_SHORT.length - 1; i >= 0; i -= 1) {
    if (
      stations.some((stn) =>
        params.some((p) => getMonthlyNumber(getParamData(stn, p), i) !== null),
      )
    ) {
      currentMonthIdx = i;
      break;
    }
  }
  const currentPeriod =
    currentMonthIdx >= 0
      ? `${MONTHS_SHORT[currentMonthIdx]} ${year}`
      : String(year);

  /* ── Trend + 3-month forecast ── */
  const { trendDataWithForecast, lastObservedMonth } = useMemo(() => {
    if (!activeChartParam || !stations.length)
      return { trendDataWithForecast: [], lastObservedMonth: null };
    const observed = MONTHS_SHORT.map((month, i) => {
      const pt = { month };
      stations.forEach((stn, idx) => {
        pt[`s${idx}`] = getMonthlyNumber(
          getParamData(stn, activeChartParam),
          i,
        );
      });
      return pt;
    }).filter((pt) =>
      stations.some(
        (_, idx) => pt[`s${idx}`] !== null && pt[`s${idx}`] !== undefined,
      ),
    );
    if (!observed.length)
      return { trendDataWithForecast: [], lastObservedMonth: null };
    const lastMonth = observed[observed.length - 1].month;
    const stationForecasts = stations.map((stn, idx) => {
      const stnObs = MONTHS_SHORT.map((month, i) => ({
        month,
        actual: getMonthlyNumber(getParamData(stn, activeChartParam), i),
      })).filter((pt) => pt.actual !== null);
      if (stnObs.length < 3) return { idx, points: [] };
      return { idx, points: buildForecast(stnObs, forecastMonths).points };
    });
    const bridged = observed.map((pt, i) => {
      if (i !== observed.length - 1) return pt;
      const bridgePt = { ...pt };
      stationForecasts.forEach(({ idx, points }) => {
        if (
          points.length &&
          bridgePt[`s${idx}`] !== null &&
          bridgePt[`s${idx}`] !== undefined
        )
          bridgePt[`s${idx}_fc`] = bridgePt[`s${idx}`];
      });
      return bridgePt;
    });
    const fcPoints = Array.from({ length: forecastMonths }, (_, fi) => {
      const pt = { month: `F${fi + 1}`, isForecast: true };
      stationForecasts.forEach(({ idx, points }) => {
        pt[`s${idx}_fc`] = points[fi]?.forecast ?? null;
      });
      return pt;
    });
    return {
      trendDataWithForecast: [...bridged, ...fcPoints],
      lastObservedMonth: lastMonth,
    };
  }, [activeChartParam, stations, forecastMonths]);

  /* ── KPI values ── */
  const selectedName =
    waterbodyOptions.find((o) => o.key === waterbodyKey)?.name || waterbodyKey;
  const doVals = stations
    .map((stn) => getLatestNumber(getParamData(stn, "DO")))
    .filter(Number.isFinite);
  const avgDO = doVals.length ? avg(doVals) : null;
  const fecalVals = stations
    .map((stn) =>
      getLatestNumber(getParamData(stn, "Fecal Coliform (MPN/100mL)")),
    )
    .filter(Number.isFinite);
  const fecalExceed = fecalVals.filter((v) => v > 1000).length;
  const bodVals = stations
    .map((stn) => getLatestNumber(getParamData(stn, "BOD")))
    .filter(Number.isFinite);
  const avgBOD = bodVals.length ? avg(bodVals) : null;
  const bodExceed = bodVals.filter((v) => v > 7).length;
  const phVals = stations
    .map((stn) => getLatestNumber(getParamData(stn, "pH")))
    .filter(Number.isFinite);
  const phExceed = phVals.filter((v) => v < 6.5 || v > 8.5).length;
  const avgPH = phVals.length ? avg(phVals) : null;
  const tssVals = stations
    .map((stn) => getLatestNumber(getParamData(stn, "TSS")))
    .filter(Number.isFinite);
  const avgTSS = tssVals.length ? avg(tssVals) : null;
  const tssExceed = tssVals.filter((v) => v > 80).length;

  /* ── Map locations ── */
  const mapLocations = useMemo(() => {
    const option = waterbodyOptions.find((o) => o.key === waterbodyKey);
    // Station-first strict resolution: only this waterbody's own stations are
    // plotted, each enriched with its record for popups and any admin
    // coordinate overrides applied.
    return resolveWaterbodyMapLocations(
      { key: waterbodyKey, name: selectedName, province: option?.province },
      stations,
      stationLocations,
    );
  }, [stationLocations, stations, selectedName, waterbodyKey, waterbodyOptions]);

  /* ── Observations ── */
  const observations = useMemo(
    () => getObservationEntries(stations),
    [stations],
  );

  /* ── AI forecast all params per station ── */
  const activeForecastStn =
    stations.find((s) => s.stnId === forecastStnId) || stations[0];
  const allForecastCards = useMemo(() => {
    if (!activeForecastStn) return [];
    return params
      .filter((p) =>
        MONTHS_SHORT.some(
          (_, i) =>
            getMonthlyNumber(getParamData(activeForecastStn, p), i) !== null,
        ),
      )
      .map((param, idx) => {
        const observed = MONTHS_SHORT.map((month, i) => ({
          month,
          actual: getMonthlyNumber(getParamData(activeForecastStn, param), i),
        })).filter((pt) => pt.actual !== null);
        if (observed.length < 3) return null;
        return { param, observed, colorIdx: idx, ...buildForecast(observed, forecastMonths) };
      })
      .filter(Boolean);
  }, [activeForecastStn, params, forecastMonths]);

  const gaugeParams = params.filter((p) =>
    stations.some((stn) => getLatestNumber(getParamData(stn, p)) !== null),
  );
  const [obsExpanded, setObsExpanded] = useState(() => {
    // expanded by default for all stations
    const init = {};
    return init;
  });
  const [forecastModalCard, setForecastModalCard] = useState(null);

  if (loading)
    return (
      <div className="pub-state-screen">
        <Spin size="large" description="Loading water quality data..." />
      </div>
    );
  if (error)
    return (
      <div className="pub-state-screen">
        <Empty description={error} />
      </div>
    );
  if (!stations.length)
    return (
      <div className="pub-state-screen">
        <Empty description="No monitoring data is available for this waterbody." />
      </div>
    );

  return (
    <div className="pub-view-wrap">
      {/* View header */}
      <div className="pub-view-head pub-animate">
        <div>
          <Text className="pub-eyebrow">Water Quality Overview</Text>
          <Title level={4} className="pub-view-title">
            {selectedName}
          </Title>
          <Text type="secondary">Data period: {currentPeriod}</Text>
        </div>
        <Select
          value={waterbodyKey}
          onChange={setWaterbodyKey}
          size="middle"
          style={{ minWidth: 220 }}
          options={waterbodyProvinceOptions(waterbodyOptions)}
          showSearch
          filterOption={(input, option) =>
            (option?.label ?? "").toLowerCase().includes(input.toLowerCase())
          }
          placeholder="Select waterbody"
        />
      </div>

      {/* KPI Tiles — 6 parameter tiles */}
      <Row gutter={[12, 12]} className="pub-kpi-row pub-animate pub-animate-d1">
        <Col xs={12} sm={8} xl={4}>
          <Card className="pub-kpi-card pub-kpi-blue" variant="borderless">
            <Statistic
              title="Monitoring Stations"
              value={stations.length}
              prefix={<span className="pub-kpi-icon pub-kpi-icon-blue"><EnvironmentOutlined /></span>}
            />
            <Text type="secondary" className="pub-kpi-note">
              Active for {year}
            </Text>
          </Card>
        </Col>
        <Col xs={12} sm={8} xl={4}>
          <Card
            className={`pub-kpi-card ${avgDO !== null && avgDO < 5 ? "pub-kpi-red" : "pub-kpi-green"}`}
            variant="borderless"
          >
            <Statistic
              title="Avg Dissolved Oxygen"
              value={avgDO !== null ? fmt(avgDO) : "\u2014"}
              suffix={avgDO !== null ? "mg/L" : ""}
              prefix={<span className="pub-kpi-icon pub-kpi-icon-green"><BarChartOutlined /></span>}
            />
            <Text type="secondary" className="pub-kpi-note">
              {avgDO !== null
                ? avgDO >= 5
                  ? "\u2713 \u22655 mg/L standard"
                  : "\u26a0 Below standard"
                : "No data"}
            </Text>
          </Card>
        </Col>
        <Col xs={12} sm={8} xl={4}>
          <Card
            className={`pub-kpi-card ${avgBOD !== null && bodExceed > 0 ? "pub-kpi-red" : avgBOD !== null && avgBOD > 5.6 ? "pub-kpi-gold" : "pub-kpi-green"}`}
            variant="borderless"
          >
            <Statistic
              title="Avg BOD"
              value={avgBOD !== null ? fmt(avgBOD) : "\u2014"}
              suffix={avgBOD !== null ? "mg/L" : ""}
              prefix={<span className="pub-kpi-icon pub-kpi-icon-red"><BarChartOutlined /></span>}
            />
            <Text type="secondary" className="pub-kpi-note">
              {avgBOD !== null
                ? bodExceed > 0
                  ? `\u26a0 ${bodExceed} stn exceeded`
                  : "\u2713 Within \u22647 mg/L"
                : "No data"}
            </Text>
          </Card>
        </Col>
        <Col xs={12} sm={8} xl={4}>
          <Card
            className={`pub-kpi-card ${avgTSS !== null && tssExceed > 0 ? "pub-kpi-gold" : "pub-kpi-green"}`}
            variant="borderless"
          >
            <Statistic
              title="Avg TSS"
              value={avgTSS !== null ? fmt(avgTSS) : "\u2014"}
              suffix={avgTSS !== null ? "mg/L" : ""}
              prefix={<span className="pub-kpi-icon pub-kpi-icon-gold"><BarChartOutlined /></span>}
            />
            <Text type="secondary" className="pub-kpi-note">
              {avgTSS !== null
                ? tssExceed > 0
                  ? `\u26a0 ${tssExceed} stn exceeded`
                  : "\u2713 Within \u226480 mg/L"
                : "No data"}
            </Text>
          </Card>
        </Col>
        <Col xs={12} sm={8} xl={4}>
          <Card
            className={`pub-kpi-card ${phExceed > 0 ? "pub-kpi-gold" : phVals.length ? "pub-kpi-green" : "pub-kpi-blue"}`}
            variant="borderless"
          >
            <Statistic
              title="Avg pH"
              value={avgPH !== null ? fmt(avgPH) : "\u2014"}
              prefix={<span className="pub-kpi-icon pub-kpi-icon-blue"><DashboardOutlined /></span>}
            />
            <Text type="secondary" className="pub-kpi-note">
              {phVals.length
                ? phExceed > 0
                  ? `\u26a0 ${phExceed} stn out of range`
                  : "\u2713 Within 6.5\u20138.5"
                : "No data"}
            </Text>
          </Card>
        </Col>
        <Col xs={12} sm={8} xl={4}>
          <Card
            className={`pub-kpi-card ${fecalExceed > 0 ? "pub-kpi-red" : fecalVals.length ? "pub-kpi-green" : "pub-kpi-blue"}`}
            variant="borderless"
          >
            <Statistic
              title="Fecal Coliform"
              value={fecalVals.length ? fecalExceed : "\u2014"}
              suffix={fecalVals.length ? ` / ${fecalVals.length} stn` : ""}
              prefix={<span className="pub-kpi-icon pub-kpi-icon-red"><ThunderboltOutlined /></span>}
            />
            <Text type="secondary" className="pub-kpi-note">
              {fecalVals.length
                ? fecalExceed > 0
                  ? "\u26a0 Above 1,000 MPN/100mL"
                  : "\u2713 Within standard"
                : "No data"}
            </Text>
          </Card>
        </Col>
      </Row>

      {/* ── Trend Chart (70%) + Station Map (30%) ── */}
      {(trendDataWithForecast.length > 0 || mapLocations.length > 0) && (
        <Row gutter={[16, 16]} className="pub-chart-map-row pub-animate pub-animate-d2" style={{ marginTop: '1rem' }}>
          {trendDataWithForecast.length > 0 && (
            <Col xs={24} lg={mapLocations.length > 0 ? 17 : 24}>
              <Card
                title={
                  <Space wrap>
                    <BarChartOutlined />
                    <span>Monthly Trend Readings</span>
                    <Select
                      size="small"
                      value={activeChartParam}
                      onChange={setChartParam}
                      options={chartParams.map((p) => ({ value: p, label: p }))}
                      style={{ minWidth: 160 }}
                      popupMatchSelectWidth={false}
                    />
                  </Space>
                }
                variant="borderless"
                className="pub-chart-card pub-eq-card"
                extra={
                  <Space size={4}>
                    <span className="pub-legend-dot pub-legend-observed" />
                    <Text style={{ fontSize: 11 }}>Observed</Text>
                    <span className="pub-legend-dot pub-legend-forecast" />
                    <Text style={{ fontSize: 11 }}>AI Forecast</Text>
                  </Space>
                }
              >
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart
                    data={trendDataWithForecast}
                    margin={{ top: 8, right: 12, bottom: 0, left: -4 }}
                  >
                    <defs>
                      {stations.map((_, i) => (
                        <linearGradient
                          key={i}
                          id={`tGrad${i}`}
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor={CHART_COLORS[i % CHART_COLORS.length]}
                            stopOpacity={0.3}
                          />
                          <stop
                            offset="95%"
                            stopColor={CHART_COLORS[i % CHART_COLORS.length]}
                            stopOpacity={0.02}
                          />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--pub-border)"
                    />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <RCTooltip
                      contentStyle={{
                        background: "var(--pub-tooltip-bg)",
                        border: "1px solid var(--pub-border)",
                        borderRadius: 8,
                      }}
                      formatter={(value, name) => [
                        value !== null ? fmt(value) : 'No data',
                        name,
                      ]}
                    />
                    <Legend wrapperStyle={{ fontSize: "0.72rem" }} />
                    {/* ── Threshold reference lines ── */}
                    {stations.map((stn, i) => (
                      <Area
                        key={`obs-${i}`}
                        type="monotone"
                        dataKey={`s${i}`}
                        name={stn.stnId}
                        stroke={CHART_COLORS[i % CHART_COLORS.length]}
                        fill={`url(#tGrad${i})`}
                        strokeWidth={2}
                        connectNulls
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                        isAnimationActive
                        animationDuration={900}
                        animationEasing="ease-out"
                      />
                    ))}
                    {stations.map((stn, i) => (
                      <Line
                        key={`fc-${i}`}
                        type="monotone"
                        dataKey={`s${i}_fc`}
                        name={`${stn.stnId} (AI)`}
                        stroke={CHART_COLORS[i % CHART_COLORS.length]}
                        strokeDasharray="6 3"
                        strokeWidth={2}
                        connectNulls
                        dot={{
                          r: 5,
                          fill: FC_COLOR,
                          stroke: CHART_COLORS[i % CHART_COLORS.length],
                          strokeWidth: 2,
                        }}
                        legenElevationdType="none"
                        isAnimationActive
                        animationDuration={1400}
                        animationEasing="ease-out"
                        animationBegin={500}
                      />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
                <div className="pub-chart-forecast-note">
                  <ThunderboltOutlined style={{ color: FC_COLOR, fontSize: 12 }} />
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    <strong>Forecast (F1–F3):</strong> AI-assisted projection using a Prophet-style additive model.
                    Dashed lines represent predicted values for the next 3 months based on historical trend and seasonality.
                    The vertical marker ▶ separates observed data from the forecast zone.
                  </Text>
                </div>
              </Card>
            </Col>
          )}
          {mapLocations.length > 0 && (
            <Col xs={24} lg={trendDataWithForecast.length > 0 ? 7 : 24}>
              <Card
                title={
                  <Space>
                    <EnvironmentOutlined />
                    <span>Station Map</span>
                  </Space>
                }
                variant="borderless"
                className="pub-map-card pub-eq-card"
              >
                <div className="pub-map-frame pub-map-frame-fill">
                  <Suspense
                    fallback={
                      <div className="pub-map-loading">
                        <Spin description="Loading map..." />
                      </div>
                    }
                  >
                    <CesiumStationMap
                      locations={mapLocations}
                      waterbodyName={selectedName}
                      height="100%"
                      emptyMessage="No mapped stations found for this waterbody."
                    />
                  </Suspense>
                </div>
              </Card>
            </Col>
          )}
        </Row>
      )}

      {/* ── Station Parameter Status with merged Field Observations ── */}
      {gaugeParams.length > 0 && (
        <>
          <Divider
            titlePlacement="left"
            className="pub-divider pub-animate pub-animate-d2"
          >
            Station Parameter Status & Field Observations
          </Divider>
          <Row
            gutter={[12, 12]}
            className="pub-station-row pub-animate pub-animate-d2"
          >
            {stations.map((stn) => {
              const alertCount = gaugeParams.filter(
                (p) =>
                  getParamStatus(p, getLatestNumber(getParamData(stn, p))) ===
                  "alert",
              ).length;
              const watchCount = gaugeParams.filter(
                (p) =>
                  getParamStatus(p, getLatestNumber(getParamData(stn, p))) ===
                  "watch",
              ).length;
              const stnObs = observations.filter(
                (obs) => obs.station.stnId === stn.stnId,
              );
              return (
                <Col
                  key={stn.stnId}
                  xs={24}
                  sm={stations.length === 1 ? 24 : 12}
                  lg={(() => {
                    const n = stations.length;
                    if (n === 1) return 24;
                    if (n === 2) return 12;
                    if (n === 4) return 6;   // 4 in one row
                    if (n >= 7) return 6;   // 4 per row
                    return 8;               // 3 per row (3,5,6)
                  })()}
                >
                  <Card
                    title={
                      <Space>
                        <EnvironmentOutlined />
                        <span>{stn.stnId}</span>
                      </Space>
                    }
                    size="small"
                    variant="borderless"
                    className="pub-station-card"
                    extra={
                      <Space size={4}>
                        {alertCount > 0 && (
                          <Tag color="error">{alertCount} Exceeded</Tag>
                        )}
                        {watchCount > 0 && (
                          <Tag color="warning">{watchCount} Near Limit</Tag>
                        )}
                        {alertCount === 0 && watchCount === 0 && (
                          <Tag color="success">All Pass</Tag>
                        )}
                      </Space>
                    }
                  >
                    <div className="pub-param-grid">
                      {gaugeParams.map((param) => {
                        const value = getLatestNumber(getParamData(stn, param));
                        const status = getParamStatus(param, value);
                        const lbl = limitLabel(param);
                        const unit = PARAM_LIMITS[param]?.unit || "";
                        return (
                          <Tooltip
                            key={param}
                            title={`${param}: ${fmt(value)}${unit ? ` ${unit}` : ""} \u2014 ${status.toUpperCase()}${lbl ? ` (Std: ${lbl})` : ""}`}
                          >
                            <div
                              className="pub-param-chip"
                              style={{ "--chip-color": STATUS_COLOR[status] }}
                            >
                              <span className="pub-param-name">
                                {param.replace(/ \(.*?\)/, "").slice(0, 16)}
                              </span>
                              <span className="pub-param-value">
                                {fmtK(value)}
                                {unit && value !== null ? (
                                  <em className="pub-param-unit">{unit}</em>
                                ) : null}
                              </span>
                              <span
                                className={`pub-param-dot${status === "alert" ? " pub-dot-alert" : status === "watch" ? " pub-dot-watch" : ""}`}
                              />
                            </div>
                          </Tooltip>
                        );
                      })}
                    </div>
                    {stnObs.length > 0 && (
                      <div className="pub-stn-obs-section">
                        <div className="pub-stn-obs-header">
                          <EyeOutlined
                            style={{ fontSize: 11, color: "var(--pub-muted)" }}
                          />
                          <Text
                            type="secondary"
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              marginLeft: 4,
                            }}
                          >
                            Field Observations
                          </Text>
                          <Tag style={{ marginLeft: 4, fontSize: 10 }}>
                            {stnObs.length}
                          </Tag>
                          <button
                            type="button"
                            className="pub-obs-toggle"
                            onClick={() =>
                              setObsExpanded((prev) => ({
                                ...prev,
                                [stn.stnId]: prev[stn.stnId] === false ? true : false,
                              }))
                            }
                          >
                          {obsExpanded[stn.stnId] !== false
                              ? "See less \u25b2"
                              : "See more \u25bc"}
                          </button>
                        </div>
                        {obsExpanded[stn.stnId] !== false && (
                          <div className="pub-obs-entries pub-obs-expanded">
                            {stnObs.map((obs, i) => {
                              const meta = getObsMeta(obs.value);
                              return (
                                <div key={i} className="pub-obs-entry">
                                  <Tag className="pub-obs-month-tag">
                                    {obs.month}
                                  </Tag>
                                  <Tag
                                    color={meta.color}
                                    className="pub-obs-status-tag"
                                  >
                                    {meta.label}
                                  </Tag>
                                  <Text className="pub-obs-text pub-obs-wrap">
                                    {obs.value}
                                  </Text>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </Card>
                </Col>
              );
            })}
          </Row>
        </>
      )}

      {/* AI Forecast — all params per station */}
      {allForecastCards.length > 0 && (
        <>
          <Divider
            titlePlacement="left"
            className="pub-divider pub-animate pub-animate-d3"
          >
            <Space>
              <ThunderboltOutlined style={{ color: FC_COLOR }} />
              AI-Assisted Forecast All Parameters
            </Space>
          </Divider>
          <div className="pub-animate pub-animate-d3">
            <div className="pub-forecast-header">
              <Space wrap>
                <Text strong>Station:</Text>
                <Select
                  size="small"
                  value={activeForecastStn?.stnId || ""}
                  onChange={setForecastStnId}
                  options={stations.map((stn) => ({
                    value: stn.stnId,
                    label: stn.stnId,
                  }))}
                  style={{ minWidth: 150 }}
                />
                <Tag color="gold">
                  {allForecastCards.length} parameters forecasted
                </Tag>
              </Space>
            </div>
            <Row gutter={[16, 16]} style={{ marginTop: 12 }}>
              {allForecastCards.map((card, idx) => {
                const total = allForecastCards.length;
                // layout: 8 params → 4+4, 7 params → 3+4, 6→3+3, 5→3+2, 4→all 6, ≤3→all 8
                let span = 8;
                if (total === 8) {
                  span = 6; // 4 per row = two rows of 4
                } else if (total > 6) {
                  if (idx >= 3 && idx < total - 3) span = 6;
                } else if (total === 5 || total === 6) {
                  if (idx >= 3) span = 6;
                } else if (total === 4) {
                  span = 6;
                }
                return (
                  <Col key={card.param} xs={24} sm={12} lg={span}>
                    <Card
                      title={
                        <Tooltip title="Click for full details">
                          <Text strong ellipsis style={{ maxWidth: 300, cursor: 'pointer' }}>
                            {getForecastParamLabel(card.param)}
                          </Text>
                        </Tooltip>
                      }
                      extra={
                        <Space size={4}>
                          <Tag
                            color={
                              card.diagnostics?.trend === "increasing"
                                ? "error"
                                : card.diagnostics?.trend === "decreasing"
                                  ? "success"
                                  : "default"
                            }
                          >
                            {card.diagnostics?.trend}
                          </Tag>
                          <Tag color="gold">
                            {card.diagnostics?.confidence}%
                          </Tag>
                        </Space>
                      }
                      variant="borderless"
                      size="small"
                      className="pub-forecast-card pub-forecast-card-clickable"
                      onClick={() => setForecastModalCard(card)}
                    >
                      <ForecastMiniChart
                        card={card}
                        colorIdx={idx}
                        height={150}
                      />
                      <div className="pub-fc-meta">
                        <Text type="secondary" style={{ fontSize: 10 }}>
                          RMSE {card.diagnostics?.rmse} Slope{" "}
                          {card.diagnostics?.slope}
                        </Text>
                        <div className="pub-fc-points">
                          {card.points.map((pt) => (
                            <span
                              key={pt.month}
                              className="pub-fc-point-badge"
                            >
                              <span className="pub-fc-point-month">
                                {pt.month}
                              </span>
                              <span className="pub-fc-point-val">
                                {fmt(pt.forecast)}
                              </span>
                            </span>
                          ))}
                        </div>
                      </div>
                    </Card>
                  </Col>
                );
              })}
            </Row>
          </div>
        </>
      )}

      <ForecastDetailModal
        card={forecastModalCard}
        stations={activeForecastStn ? [activeForecastStn] : stations}
        open={!!forecastModalCard}
        onClose={() => setForecastModalCard(null)}
      />
    </div>
  );
};

/* ─────────────────────────────────────
   TABULAR VIEW
───────────────────────────────────── */
const TabularView = ({
  sheets,
  waterbodyKey,
  setWaterbodyKey,
  waterbodyOptions,
  year,
  loading,
  error,
}) => {
  const sheet = sheets.find((s) => s.key === waterbodyKey);
  const stations = useMemo(() => getReadableStations(sheet), [sheet]);
  const params = useMemo(() => getAvailableParams(stations, false), [stations]);
  const selectedName =
    waterbodyOptions.find((o) => o.key === waterbodyKey)?.name || waterbodyKey;

  const [searchParam, setSearchParam] = useState("");
  const [filterStation, setFilterStation] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterMonth, setFilterMonth] = useState("latest");
  const [exportingParam, setExportingParam] = useState("");
  const [showForecastFor, setShowForecastFor] = useState({});
  const [requestOpen, setRequestOpen] = useState(false);
  const [pendingExportFn, setPendingExportFn] = useState(null);
  // Reactive forecast horizon — applies admin changes immediately.
  const forecastMonths = useForecastMonths();

  const visibleStations =
    filterStation === "all"
      ? stations
      : stations.filter((s) => s.stnId === filterStation);
  const visibleParams = params.filter(
    (p) => !searchParam || p.toLowerCase().includes(searchParam.toLowerCase()),
  );

  /* Pre-compute all param forecasts */
  const allParamForecasts = useMemo(() => {
    const result = {};
    params.forEach((param) => {
      result[param] = stations
        .map((stn, sIdx) => {
          const observed = MONTHS_SHORT.map((month, i) => ({
            month,
            actual: getMonthlyNumber(getParamData(stn, param), i),
          })).filter((pt) => pt.actual !== null);
          if (observed.length < 3) return null;
          return { stn: stn.stnId, colorIdx: sIdx, ...buildForecast(observed, forecastMonths) };
        })
        .filter(Boolean);
    });
    return result;
  }, [params, stations, forecastMonths]);

  /* Overview data with filters */
  const overviewData = useMemo(
    () =>
      visibleStations
        .map((stn, idx) => {
          const row = { key: `ov-${idx}`, stnId: stn.stnId };
          params.forEach((p) => {
            if (filterMonth === "latest") {
              row[p] = getLatestNumber(getParamData(stn, p));
            } else {
              const mi = parseInt(filterMonth, 10);
              row[p] = getMonthlyNumber(getParamData(stn, p), mi);
            }
          });
          // Observation for the selected month (or latest)
          const obsPd = getParamData(stn, "Observation");
          if (filterMonth === "latest") {
            const obsMonthly = obsPd?.monthly || [];
            let latestObs = null;
            for (let i = obsMonthly.length - 1; i >= 0; i--) {
              if (obsMonthly[i] && String(obsMonthly[i]).trim()) { latestObs = String(obsMonthly[i]).trim(); break; }
            }
            row._obs = latestObs;
          } else {
            const mi = parseInt(filterMonth, 10);
            const v = obsPd?.monthly?.[mi];
            row._obs = v && String(v).trim() ? String(v).trim() : null;
          }
          const statuses = params.map((p) => getParamStatus(p, row[p]));
          row._alertCount = statuses.filter((s) => s === "alert").length;
          row._watchCount = statuses.filter((s) => s === "watch").length;
          return row;
        })
        .filter((row) => {
          if (filterStatus === "all") return true;
          if (filterStatus === "alert") return row._alertCount > 0;
          if (filterStatus === "watch") return row._watchCount > 0;
          if (filterStatus === "pass")
            return row._alertCount === 0 && row._watchCount === 0;
          return true;
        }),
    [visibleStations, params, filterStatus, filterMonth],
  );

  const overviewColumns = useMemo(
    () => [
      {
        title: "Station",
        dataIndex: "stnId",
        key: "stnId",
        fixed: "left",
        width: 150,
        render: (val, row) => (
          <Space orientation="vertical" size={2}>
            <Text strong>{val}</Text>
            <Space size={2}>
              {row._alertCount > 0 && (
                <Tag color="error" style={{ fontSize: 10, padding: "0 4px" }}>
                  {row._alertCount} ⚠
                </Tag>
              )}
              {row._watchCount > 0 && (
                <Tag color="warning" style={{ fontSize: 10, padding: "0 4px" }}>
                  {row._watchCount} ~
                </Tag>
              )}
            </Space>
          </Space>
        ),
      },
      ...params.map((p) => ({
        title: (
          <Tooltip title={p}>
            <span style={{ fontSize: 11 }}>
              {p.replace(/ \(.*?\)/, "").slice(0, 12)}
            </span>
          </Tooltip>
        ),
        dataIndex: p,
        key: p,
        width: 90,
        align: "center",
        render: (val) => {
          if (val === null || val === undefined)
            return (
              <Text type="secondary" style={{ fontSize: 11 }}>
                —
              </Text>
            );
          const status = getParamStatus(p, val);
          return (
            <Tooltip title={`${p}: ${fmt(val)} — ${status}`}>
              <Tag
                color={STATUS_TAG[status]}
                style={{
                  fontWeight: 700,
                  minWidth: 44,
                  textAlign: "center",
                  fontSize: 11,
                }}
              >
                {fmt(val)}
              </Tag>
            </Tooltip>
          );
        },
      })),
      {
        title: <Space size={2}><EyeOutlined style={{ fontSize: 11 }} /><span style={{ fontSize: 11 }}>Observations</span></Space>,
        dataIndex: "_obs",
        key: "_obs",
        width: 160,
        render: (val) => {
          if (!val) return <Text type="secondary" style={{ fontSize: 11 }}>no data</Text>;
          const meta = getObsMeta(val);
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Tag color={meta.color} style={{ fontSize: 10, padding: '0 4px', alignSelf: 'flex-start' }}>{meta.label}</Tag>
              <Text style={{ fontSize: 11, whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.35 }}>{val}</Text>
            </div>
          );
        },
      },
    ],
    [params],
  );

  /* Monthly table per param */
  const buildParamTable = useCallback(
    (param) => {
      const tableData = stations.map((stn, idx) => {
        const pd = getParamData(stn, param);
        const row = { key: `${param}-${idx}`, stnId: stn.stnId };
        MONTHS_SHORT.forEach((_, mi) => {
          row[`m${mi}`] = getMonthlyNumber(pd, mi);
        });
        const monthlyVals = MONTHS_SHORT.map((_, mi) =>
          getMonthlyNumber(pd, mi),
        ).filter(Number.isFinite);
        row.avg = monthlyVals.length ? avg(monthlyVals) : null;
        return row;
      });
      const cols = [
        {
          title: "Station",
          dataIndex: "stnId",
          key: "stnId",
          fixed: "left",
          width: 110,
          render: (v) => (
            <Text strong style={{ fontSize: 12 }}>
              {v}
            </Text>
          ),
        },
        ...MONTHS_SHORT.map((month, idx) => ({
          title: <span style={{ fontSize: 11 }}>{month}</span>,
          dataIndex: `m${idx}`,
          key: `m${idx}`,
          width: 62,
          align: "center",
          render: (val) => {
            if (val === null || val === undefined)
              return (
                <Text type="secondary" style={{ fontSize: 11 }}>
                  —
                </Text>
              );
            const status = getParamStatus(param, val);
            return (
              <span
                style={{
                  color: STATUS_COLOR[status],
                  fontWeight: 700,
                  fontSize: 11,
                }}
              >
                {fmt(val)}
              </span>
            );
          },
        })),
        {
          title: <span style={{ fontSize: 11 }}>Avg</span>,
          dataIndex: "avg",
          key: "avg",
          fixed: "right",
          width: 72,
          align: "center",
          render: (val) => {
            if (val === null || val === undefined)
              return (
                <Text type="secondary" style={{ fontSize: 11 }}>
                  —
                </Text>
              );
            const status = getParamStatus(param, val);
            return (
              <Tag
                color={STATUS_TAG[status]}
                style={{ fontSize: 11, fontWeight: 700 }}
              >
                {fmt(val)}
              </Tag>
            );
          },
        },
        {
          title: <span style={{ fontSize: 11, color: 'var(--pub-muted)' }}>Std</span>,
          key: "std",
          width: 90,
          align: "center",
          render: () => {
            const lbl = limitLabel(param);
            return lbl ? (
              <Text type="secondary" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>{lbl}</Text>
            ) : (
              <Text type="secondary" style={{ fontSize: 10 }}>—</Text>
            );
          },
        },
      ];
      return { tableData, cols };
    },
    [stations],
  );

  /* Per-param CSV export */
  const doExportParamCsv = useCallback(
    (param) => {
      setExportingParam(param);
      const { tableData } = buildParamTable(param);
      const l = PARAM_LIMITS[param];
      const std = l
        ? l.min
          ? `Min: ${l.min} ${l.unit || ""}`
          : `Max: ${l.max} ${l.unit || ""}`
        : "No standard";
      const BOM = "\uFEFF";
      const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const lines = [
        esc("EMB Region III \u2014 WQMS Monthly Reading Export"),
        `${esc("Waterbody")},${esc(selectedName)}`,
        `${esc("Parameter")},${esc(param)}`,
        `${esc("Standard")},${esc(std)}`,
        `${esc("Data Year")},${esc(year)}`,
        "",
        [
          esc("Station"),
          ...MONTHS_SHORT.map(esc),
          esc("Annual Avg"),
          esc("Status"),
        ].join(","),
      ];
      tableData.forEach((row) => {
        const monthly = MONTHS_SHORT.map((_, mi) => row[`m${mi}`] ?? "");
        const st = getParamStatus(param, row.avg);
        const stLabel =
          st === "alert"
            ? "EXCEEDED"
            : st === "watch"
              ? "NEAR LIMIT"
              : st === "safe"
                ? "PASS"
                : "\u2014";
        lines.push(
          [esc(row.stnId), ...monthly, row.avg ?? "", esc(stLabel)].join(","),
        );
      });
      downloadBlob(
        BOM + lines.join("\n"),
        `WQMS_${waterbodyKey}_${param.replace(/[^\w]/g, "_")}_${year}.csv`,
        "text/csv;charset=utf-8;",
      );
      setTimeout(() => setExportingParam(""), 1000);
    },
    [buildParamTable, selectedName, waterbodyKey, year],
  );

  const exportParamCsv = useCallback(
    (param) => {
      setPendingExportFn(() => () => doExportParamCsv(param));
      setRequestOpen(true);
    },
    [doExportParamCsv],
  );

  /* Collapse items */
  const collapseItems = useMemo(
    () =>
      visibleParams
        .map((param) => {
          const { tableData, cols } = buildParamTable(param);
          const hasData = tableData.some((row) =>
            MONTHS_SHORT.some(
              (_, mi) => row[`m${mi}`] !== null && row[`m${mi}`] !== undefined,
            ),
          );
          if (!hasData) return null;
          const allVals = tableData.flatMap((row) =>
            MONTHS_SHORT.map((_, mi) => row[`m${mi}`]).filter(
              (v) => v !== null && v !== undefined,
            ),
          );
          const alertCount = allVals.filter(
            (v) => getParamStatus(param, v) === "alert",
          ).length;
          const watchCount = allVals.filter(
            (v) => getParamStatus(param, v) === "watch",
          ).length;
          const lbl = limitLabel(param);
          const fcData = allParamForecasts[param] || [];
          const isFcShown = showForecastFor[param];

          return {
            key: param,
            label: (
              <Space size={6} wrap>
                <Text strong style={{ fontSize: 13 }}>
                  {param}
                </Text>
                {lbl && <Tag style={{ fontSize: 10 }}>Std: {lbl}</Tag>}
                {alertCount > 0 && (
                  <Tag color="error" style={{ fontSize: 10 }}>
                    {alertCount} Exceeded
                  </Tag>
                )}
                {watchCount > 0 && (
                  <Tag color="warning" style={{ fontSize: 10 }}>
                    {watchCount} Near Limit
                  </Tag>
                )}
                {alertCount === 0 && watchCount === 0 && allVals.length > 0 && (
                  <Tag color="success" style={{ fontSize: 10 }}>
                    All Pass
                  </Tag>
                )}
              </Space>
            ),
            extra: (
              <Space size={4} onClick={(e) => e.stopPropagation()}>
                {fcData.length > 0 && (
                  <Button
                    size="small"
                    icon={<ThunderboltOutlined />}
                    type={isFcShown ? "primary" : "default"}
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowForecastFor((prev) => ({
                        ...prev,
                        [param]: !prev[param],
                      }));
                    }}
                    style={{ fontSize: 11 }}
                  >
                    {isFcShown ? "Hide Forecast" : "AI Forecast"}
                  </Button>
                )}
                <Button
                  size="small"
                  icon={<DownloadOutlined />}
                  loading={exportingParam === param}
                  onClick={(e) => {
                    e.stopPropagation();
                    exportParamCsv(param);
                  }}
                  style={{ fontSize: 11 }}
                >
                  Export
                </Button>
              </Space>
            ),
            children: (
              <div>
                <Table
                  columns={cols}
                  dataSource={tableData}
                  size="small"
                  scroll={{ x: "max-content" }}
                  pagination={false}
                  className="pub-table"
                />
                {isFcShown && fcData.length > 0 && (
                  <div className="pub-param-forecast-wrap">
                    <div className="pub-fc-label">
                      <ThunderboltOutlined style={{ color: FC_COLOR }} />
                      <Text
                        type="secondary"
                        style={{ fontSize: 12, marginLeft: 6 }}
                      >
                        AI Forecast Prophet additive model 3-month
                        projection
                      </Text>
                    </div>
                    <Row gutter={[12, 12]} style={{ marginTop: 8 }}>
                      {fcData.map((fc) => (
                        <Col
                          key={fc.stn}
                          xs={24}
                          md={stations.length > 2 ? 8 : 12}
                        >
                          <div className="pub-mini-fc-card">
                            <Space size={4} style={{ marginBottom: 4 }}>
                              <Text strong style={{ fontSize: 12 }}>
                                {fc.stn}
                              </Text>
                              <Tag
                                color={
                                  fc.diagnostics?.trend === "increasing"
                                    ? "error"
                                    : fc.diagnostics?.trend === "decreasing"
                                      ? "success"
                                      : "default"
                                }
                                style={{ fontSize: 10 }}
                              >
                                {fc.diagnostics?.trend}
                              </Tag>
                              <Tag color="gold" style={{ fontSize: 10 }}>
                                {fc.diagnostics?.confidence}%
                              </Tag>
                            </Space>
                            <ForecastMiniChart
                              card={fc}
                              colorIdx={fc.colorIdx}
                              height={130}
                            />
                            <div
                              className="pub-fc-points"
                              style={{ marginTop: 6 }}
                            >
                              {fc.points.map((pt) => (
                                <span
                                  key={pt.month}
                                  className="pub-fc-point-badge"
                                >
                                  <span className="pub-fc-point-month">
                                    {pt.month}
                                  </span>
                                  <span className="pub-fc-point-val">
                                    {fmt(pt.forecast)}
                                  </span>
                                </span>
                              ))}
                            </div>
                          </div>
                        </Col>
                      ))}
                    </Row>
                  </div>
                )}
              </div>
            ),
          };
        })
        .filter(Boolean),
    [
      visibleParams,
      buildParamTable,
      exportParamCsv,
      exportingParam,
      showForecastFor,
      allParamForecasts,
      stations.length,
    ],
  );

  if (loading)
    return (
      <div className="pub-state-screen">
        <Spin size="large" description="Loading..." />
      </div>
    );
  if (error)
    return (
      <div className="pub-state-screen">
        <Empty description={error} />
      </div>
    );
  if (!stations.length)
    return (
      <div className="pub-state-screen">
        <Empty description="No data available." />
      </div>
    );

  return (
    <div className="pub-view-wrap">
      <div className="pub-view-head pub-animate">
        <div>
          <Text className="pub-eyebrow">Data Tables</Text>
          <Title level={4} className="pub-view-title">
            {selectedName}
          </Title>
        </div>
        <Select
          value={waterbodyKey}
          onChange={setWaterbodyKey}
          size="middle"
          style={{ minWidth: 220 }}
          options={waterbodyProvinceOptions(waterbodyOptions)}
          showSearch
          filterOption={(input, option) =>
            (option?.label ?? "").toLowerCase().includes(input.toLowerCase())
          }
        />
      </div>

      {/* Latest readings with filters */}
      <Card
        title={
          <Space>
            <TableOutlined />
            <span>Latest Parameter Readings</span>
          </Space>
        }
        variant="borderless"
        className="pub-table-card pub-animate pub-animate-d1"
        extra={
          <Space wrap>
            <Select
              size="small"
              value={filterMonth}
              onChange={setFilterMonth}
              style={{ minWidth: 110 }}
              options={[
                { value: "latest", label: "Latest" },
                ...MONTHS_SHORT.map((m, i) => ({ value: String(i), label: `${m} (${i + 1})` })),
              ]}
            />
            <Select
              size="small"
              value={filterStation}
              onChange={setFilterStation}
              style={{ minWidth: 130 }}
              options={[
                { value: "all", label: "All Stations" },
                ...stations.map((s) => ({ value: s.stnId, label: s.stnId })),
              ]}
            />
            <Select
              size="small"
              value={filterStatus}
              onChange={setFilterStatus}
              style={{ minWidth: 120 }}
              options={[
                { value: "all", label: "All Status" },
                { value: "alert", label: "\u26a0 Exceeded" },
                { value: "watch", label: "~ Near Limit" },
                { value: "pass", label: "\u2713 All Pass" },
              ]}
            />
          </Space>
        }
      >
        {overviewData.length === 0 ? (
          <Empty description="No stations match the current filter." />
        ) : (
          <Table
            columns={overviewColumns}
            dataSource={overviewData}
            size="small"
            scroll={{ x: "max-content" }}
            pagination={false}
            className="pub-table"
          />
        )}
      </Card>

      {/* Per-parameter expand/collapse */}
      <Divider
        titlePlacement="left"
        className="pub-divider pub-animate pub-animate-d2"
      >
        <Space>
          <BarChartOutlined />
          Monthly Readings by Parameter
        </Space>
      </Divider>
      <div className="pub-param-search-bar pub-animate pub-animate-d2">
        <Input
          prefix={<SearchOutlined />}
          placeholder="Search parameter..."
          value={searchParam}
          onChange={(e) => setSearchParam(e.target.value)}
          allowClear
          style={{ maxWidth: 280 }}
          size="small"
        />
        <Text type="secondary" style={{ fontSize: 12 }}>
          {collapseItems.length} of {params.length} parameters
        </Text>
      </div>
      {collapseItems.length > 0 ? (
        <Collapse
          items={collapseItems}
          variant="borderless"
          className="pub-collapse pub-animate pub-animate-d2"
          expandIconPlacement="start"
        />
      ) : (
        <Empty
          description="No parameters match your search."
          style={{ marginTop: 24 }}
        />
      )}

      <RequestReminderModal
        open={requestOpen}
        onConfirm={() => { setRequestOpen(false); if (pendingExportFn) { pendingExportFn(); setPendingExportFn(null); } }}
        onCancel={() => { setRequestOpen(false); setPendingExportFn(null); }}
      />
    </div>
  );
};

/* ─────────────────────────────────────
   EXPORT VIEW
───────────────────────────────────── */
const ExportView = ({
  sheets,
  waterbodyKey,
  setWaterbodyKey,
  waterbodyOptions,
  year,
}) => {
  const sheet = sheets.find((s) => s.key === waterbodyKey);
  const stations = useMemo(() => getReadableStations(sheet), [sheet]);
  const params = useMemo(() => getAvailableParams(stations, false), [stations]);
  const selectedName =
    waterbodyOptions.find((o) => o.key === waterbodyKey)?.name || waterbodyKey;
  const [exporting, setExporting] = useState("");
  const [requestOpen, setRequestOpen] = useState(false);
  const [pendingExportFn, setPendingExportFn] = useState(null);

  const withRequest = (fn) => {
    setPendingExportFn(() => fn);
    setRequestOpen(true);
  };

  const exportExcelCsv = () => withRequest(() => {
    setExporting("excel");
    downloadBlob(
      buildExcelCsv(selectedName, waterbodyKey, year, stations, params),
      `WQMS_${waterbodyKey}_${year}.csv`,
      "text/csv;charset=utf-8;",
    );
    setTimeout(() => setExporting(""), 1200);
  });

  const exportJson = () => withRequest(() => {
    setExporting("json");
    const data = {
      source: "EMB Region III \u2014 Water Quality Monitoring System",
      waterbody: selectedName,
      key: waterbodyKey,
      year,
      exportedAt: new Date().toISOString(),
      parameterStandards: Object.fromEntries(
        params.filter((p) => PARAM_LIMITS[p]).map((p) => [p, PARAM_LIMITS[p]]),
      ),
      stations: stations.map((stn) => ({
        stnId: stn.stnId,
        stnNo: stn.stnNo,
        params: Object.fromEntries(
          params.map((p) => {
            const pd = getParamData(stn, p);
            const monthly = MONTHS_SHORT.map((_, i) => ({
              month: MONTHS_SHORT[i],
              value: getMonthlyNumber(pd, i),
            }));
            const latest = getLatestNumber(pd);
            return [
              p,
              {
                monthly,
                annualAvg: getAverageNumber(pd),
                latest,
                status: getParamStatus(p, latest),
                unit: PARAM_LIMITS[p]?.unit || null,
              },
            ];
          }),
        ),
      })),
    };
    downloadBlob(
      JSON.stringify(data, null, 2),
      `WQMS_${waterbodyKey}_${year}.json`,
      "application/json",
    );
    setTimeout(() => setExporting(""), 1200);
  });

  const exportAllExcelCsv = () => withRequest(() => {
    setExporting("all");
    downloadBlob(
      buildAllExcelCsv(year, sheets),
      `WQMS_All_${year}.csv`,
      "text/csv;charset=utf-8;",
    );
    setTimeout(() => setExporting(""), 1500);
  });

  return (
    <div className="pub-view-wrap">
      <div className="pub-view-head pub-animate">
        <div>
          <Text className="pub-eyebrow">Export Data</Text>
          <Title level={4} className="pub-view-title">
            Download Water Quality Records
          </Title>
          <Text type="secondary">
            Data requests are handled by EMB Region III. Submit a request at{" "}
            <a href="https://r3.emb.gov.ph" target="_blank" rel="noreferrer">r3.emb.gov.ph</a>{" "}
            before downloading.
          </Text>
        </div>
        <Select
          value={waterbodyKey}
          onChange={setWaterbodyKey}
          size="middle"
          style={{ minWidth: 220 }}
          options={waterbodyProvinceOptions(waterbodyOptions)}
          showSearch
          filterOption={(input, option) =>
            (option?.label ?? "").toLowerCase().includes(input.toLowerCase())
          }
        />
      </div>

      {/* Data request notice */}
      <Alert
        type="warning"
        showIcon
        className="pub-animate pub-animate-d1"
        style={{ marginBottom: 16, borderRadius: '0.75rem' }}
        title={
          <span>
            <strong>Data Access Request Required.</strong> To download water quality data, please submit a formal data request to EMB Region III at{" "}
            <a href="https://r3.emb.gov.ph" target="_blank" rel="noreferrer">r3.emb.gov.ph</a>.
            Downloads below are available after your request is approved.
          </span>
        }
      />

      <Row
        gutter={[16, 16]}
        className="pub-export-row pub-animate pub-animate-d1"
      >
        <Col xs={24} md={8}>
          <Card className="pub-export-card" variant="borderless" hoverable>
            <div className="pub-export-icon pub-export-icon-blue">
              <FileExcelOutlined style={{ fontSize: 30 }} />
            </div>
            <Title level={5}>Excel CSV — Selected Waterbody</Title>
            <Text type="secondary">
              Structured Excel CSV with metadata, parameter standards, monthly
              readings, annual averages, and compliance status for{" "}
              <strong>{selectedName}</strong>.
            </Text>
            <div className="pub-export-meta">
              <Tag color="blue">{stations.length} stations</Tag>
              <Tag color="blue">{params.length} parameters</Tag>
              <Tag>Excel-ready</Tag>
            </div>
            <Alert
              type="info"
              showIcon
              title="Request required before downloading."
              style={{ marginTop: 10, fontSize: 11 }}
            />
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={exportExcelCsv}
              loading={exporting === "excel"}
              block
              style={{ marginTop: 14 }}
            >
              Download Excel CSV
            </Button>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card className="pub-export-card" variant="borderless" hoverable>
            <div className="pub-export-icon pub-export-icon-green">
              <DownloadOutlined style={{ fontSize: 30 }} />
            </div>
            <Title level={5}>JSON — Selected Waterbody</Title>
            <Text type="secondary">
              Fully structured JSON with monthly data, annual averages,
              compliance status, and parameter standards for{" "}
              <strong>{selectedName}</strong>.
            </Text>
            <div className="pub-export-meta">
              <Tag color="green">Structured</Tag>
              <Tag color="green">With standards</Tag>
              <Tag color="green">Status included</Tag>
            </div>
            <Alert
              type="info"
              showIcon
              title="Request required before downloading."
              style={{ marginTop: 10, fontSize: 11 }}
            />
            <Button
              icon={<DownloadOutlined />}
              onClick={exportJson}
              loading={exporting === "json"}
              block
              style={{ marginTop: 14 }}
            >
              Download JSON
            </Button>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card className="pub-export-card" variant="borderless" hoverable>
            <div className="pub-export-icon pub-export-icon-gold">
              <FileExcelOutlined style={{ fontSize: 30 }} />
            </div>
            <Title level={5}>Excel CSV — All Waterbodies</Title>
            <Text type="secondary">
              Comprehensive Excel CSV covering all {sheets.length} waterbodies
              — monthly readings, annual averages, and compliance for every
              station.
            </Text>
            <div className="pub-export-meta">
              <Tag color="gold">{sheets.length} waterbodies</Tag>
              <Tag color="gold">All stations</Tag>
            </div>
            <Alert
              type="warning"
              showIcon
              title="Large file — request required before downloading."
              style={{ marginTop: 10, fontSize: 11 }}
            />
            <Button
              icon={<DownloadOutlined />}
              onClick={exportAllExcelCsv}
              loading={exporting === "all"}
              block
              style={{ marginTop: 14 }}
            >
              Download All Data
            </Button>
          </Card>
        </Col>
      </Row>
      <Card
        variant="borderless"
        className="pub-export-note pub-animate pub-animate-d2"
        style={{ marginTop: 16 }}
      >
        <Alert
          type="info"
          showIcon
          title={
            <span>
              <strong>How to Request:</strong> Visit{" "}
              <a href="https://r3.emb.gov.ph" target="_blank" rel="noreferrer">
                r3.emb.gov.ph
              </a>{" "}
              to submit a data access request. EMB Region III will review and provide access to the requested dataset.
            </span>
          }
        />
      </Card>

      <RequestReminderModal
        open={requestOpen}
        onConfirm={() => { setRequestOpen(false); if (pendingExportFn) { pendingExportFn(); setPendingExportFn(null); } }}
        onCancel={() => { setRequestOpen(false); setPendingExportFn(null); }}
      />
    </div>
  );
};

/* ─────────────────────────────────────
   FOOTER
───────────────────────────────────── */
const PubFooter = ({ year }) => (
  <footer className="pub-footer">
    <div className="pub-footer-inner">
      <div className="pub-footer-brand">
        <img src={embLogo} alt="EMB Region III" className="pub-footer-logo" />
        <img src={bagongPilipinasLogo} alt="Bagong Pilipinas" className="pub-footer-logo pub-footer-logo-bp" />
        <div className="pub-footer-org-info">
          <strong>Environmental Management Bureau — Region III</strong>
          <span>Water Quality Monitoring System</span>
        </div>
      </div>
      <address className="pub-footer-contact-inline">
        <a href="https://r3.emb.gov.ph" target="_blank" rel="noreferrer">
          <GlobalOutlined /> r3.emb.gov.ph
        </a>
        <span className="pub-footer-sep">·</span>
        <a
          href="https://www.facebook.com/EMB3Official"
          target="_blank"
          rel="noreferrer"
        >
          <TeamOutlined /> EMB3Official
        </a>
        <span className="pub-footer-sep">·</span>
        <span>
          <EnvironmentOutlined /> Masinop cor. Matalino St., Diosdado Macapagal
          Gov&apos;t Center, Maimpis, San Fernando, Pampanga
        </span>
        <span className="pub-footer-sep">·</span>
        <span>&copy; {new Date().getFullYear()} EMB Region III WQMS{year ? ` · ${year} Data` : ""}</span>
      </address>
    </div>
  </footer>
);

/* ─────────────────────────────────────
   MAIN PUBLIC DASHBOARD
───────────────────────────────────── */
const PublicDashboard = () => {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  const [currentDateTime, setCurrentDateTime] = useState(() => new Date());
  const [collapsed, setCollapsed] = useState(false);
  const [menuKey, setMenuKey] = useState("dashboard");
  const { year, sheets, loading, error } = usePublishedWqmDataset();
  const waterbodyOptions = useMemo(
    () => buildWaterbodyOptions(sheets),
    [sheets],
  );
  const [waterbodyKey, setWaterbodyKey] = useState("");
  const [stationLocations, setStationLocations] = useState([]);

  useEffect(() => {
    if (
      waterbodyOptions.length &&
      !waterbodyOptions.some((o) => o.key === waterbodyKey)
    ) {
      setWaterbodyKey(waterbodyOptions[0]?.key || "");
    }
  }, [waterbodyOptions, waterbodyKey]);

  useEffect(() => {
    let cancelled = false;
    loadStationLocationsCached()
      .then((locs) => {
        if (!cancelled) setStationLocations(locs);
      })
      .catch(() => {
        if (!cancelled) setStationLocations([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => setCurrentDateTime(new Date()), 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  const menuItems = [
    { key: "dashboard", icon: <DashboardOutlined />, label: "Dashboard" },
    { key: "tabular", icon: <TableOutlined />, label: "Tabular Data" },
    { key: "export", icon: <DownloadOutlined />, label: "Export Data" },
  ];

  const sharedProps = {
    sheets,
    waterbodyKey,
    setWaterbodyKey,
    waterbodyOptions,
    year,
    loading,
    error,
  };

  return (
    <Layout className={`pub-layout ${isDark ? "pub-dark" : "pub-light"}`}>
      <Header className="pub-header">
        <div className="pub-header-brand">
          <img src={embLogo} alt="EMB Region III" className="pub-logo" />
          <img src={bagongPilipinasLogo} alt="Bagong Pilipinas" className="pub-logo pub-logo-bp" />
          <div className="pub-header-titles">
            <span className="pub-header-org">
              Environmental Management Bureau Region III
            </span>
            <span className="pub-header-name">
              Water Quality Monitoring System Dashboard
            </span>
          </div>
        </div>
        <div className="pub-header-actions">
          {/* <span className="pub-header-badge">Public Dashboard {year}</span> */}
          <div className="pub-header-datetime" aria-live="polite">
            <span className="pub-header-datetime-label">Philippine Time</span>
            <span className="pub-header-datetime-time">{HEADER_TIME_FORMATTER.format(currentDateTime)}</span>
            <span className="pub-header-datetime-date">{HEADER_DATE_FORMATTER.format(currentDateTime)}</span>
          </div>
          <Button
            type="text"
            icon={isDark ? <SunOutlined /> : <MoonOutlined />}
            onClick={toggle}
            className="pub-theme-btn"
            aria-label="Toggle theme"
          />
          {/* <Link to="/login">
            <Button type="primary" size="small">
              Staff Login
            </Button>
          </Link> */}
        </div>
      </Header>
      <Layout>
        <Sider
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          breakpoint="md"
          theme={isDark ? "dark" : "light"}
          className="pub-sider"
          width={220}
          collapsedWidth={64}
          trigger={
            <div className="pub-sider-trigger">
              {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            </div>
          }
        >
          <div className="pub-sider-logo">
            {!collapsed && <span className="pub-sider-label">Navigation</span>}
          </div>
          <Menu
            mode="inline"
            selectedKeys={[menuKey]}
            onSelect={({ key }) => setMenuKey(key)}
            items={menuItems}
            className="pub-menu"
            theme={isDark ? "dark" : "light"}
          />
          {!collapsed && (
            <div className="pub-sider-footer">
              <Text type="secondary" className="pub-sider-foot-text">
                EMB R3 \u00b7 {year} Data
              </Text>
            </div>
          )}
        </Sider>
        <Content className="pub-content">
          <div className="pub-content-inner">
            {menuKey === "dashboard" && (
              <DashboardView
                {...sharedProps}
                stationLocations={stationLocations}
              />
            )}
            {menuKey === "tabular" && <TabularView {...sharedProps} />}
            {menuKey === "export" && <ExportView {...sharedProps} />}
          </div>
          <PubFooter year={year} />
        </Content>
      </Layout>
    </Layout>
  );
};

export default PublicDashboard;

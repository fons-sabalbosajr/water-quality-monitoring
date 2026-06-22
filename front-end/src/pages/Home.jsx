import {
  Fragment,
  Suspense,
  lazy,
  useState,
  useRef,
  useEffect,
  useMemo,
} from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  LabelList,
} from "recharts";
import { Button, Select } from "antd";
import { PauseCircleOutlined, PlayCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import bagongLogo from "../assets/bagongpilipinaslogo.png";
import embLogo from "../assets/emblogo.svg";
import WQM2026 from "./WQM2026";
import Settings from "./Settings";
import WaterbodyProfile from "./WaterbodyProfile";
import { logActivity } from "../utils/appLog";
import encryptedStorage from "../utils/encryptedStorage";
import {
  useLineChartMergeSettings,
  buildMultiYearTrend,
} from "../utils/lineChartSettings";
import {
  IcoDashboard,
  IcoTable,
  IcoWater,
  IcoSettings,
  IcoChevronDown,
  IcoChevronRight,
  IcoCalendar,
  IcoSun,
  IcoMoon,
  IcoLogout,
  IcoMapPin,
  IcoWaves,
  IcoBoat,
  IcoAlertTriangle,
  IcoCheckCircle,
  IcoEye,
  IcoMenu,
} from "../components/Icons";
import {
  MONTHS_SHORT,
  PARAM_LIMITS,
  PARAM_ORDER,
  fmt,
  fmtWithUnit,
  getAvailableParams,
  getAverageNumber,
  getGaugePercent,
  getLatestNumber,
  getMonthlyNumber,
  getObservationEntries,
  getParamData,
  getParamStatus,
  getParamUnit,
  hasNumericReading,
} from "../utils/wqmData";
import {
  buildWaterbodyOptions,
  getReadableStations,
  groupWaterbodyByProvince,
  useTabularYears,
  useWqmSheets,
  usePublishedWqmDataset,
  useAllYearSheets,
} from "../utils/wqmSheets";
import { loadStationLocationsCached } from "../utils/stationWorkbook";
import { resolveWaterbodyMapLocations } from "../utils/stationGeo";
import NewMonitoringYearModal from "../components/NewMonitoringYearModal";
import "./Home.css";

const Waterbody3DMap = lazy(() => import("./Waterbody3DMap"));
const VisualizationView = lazy(() => import("./Visualizations"));
const CesiumStationMap = lazy(() => import("../components/CesiumStationMap"));

/* ── Constants ── */
const CHART_PARAMS = PARAM_ORDER;

const CHART_COLORS = [
  "#446ACB",
  "#7CB675",
  "#e07b54",
  "#a78bfa",
  "#f59e0b",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
  "#f97316",
  "#64748b",
  "#10b981",
];

const buildStationTrendData = (stationSeries, param) =>
  MONTHS_SHORT.map((label, monthIndex) => {
    const point = { label };
    stationSeries.forEach(({ station, chartKey }) => {
      point[chartKey] = getMonthlyNumber(
        getParamData(station, param),
        monthIndex,
      );
    });
    return point;
  }).filter((point) =>
    stationSeries.some(
      ({ chartKey }) =>
        point[chartKey] !== null && point[chartKey] !== undefined,
    ),
  );

const hasMonthlyParamReading = (stations, param) =>
  stations.some((station) =>
    MONTHS_SHORT.some(
      (_, monthIndex) =>
        getMonthlyNumber(getParamData(station, param), monthIndex) !== null,
    ),
  );

const buildStationGaugeData = (stations, params) =>
  stations.map((station) => ({
    station,
    metrics: params
      .map((param) => {
        const value = getLatestNumber(getParamData(station, param));
        return {
          param,
          value,
          percent: getGaugePercent(param, value),
          status: getParamStatus(param, value),
          unit: PARAM_LIMITS[param]?.unit || "",
          label: PARAM_LIMITS[param]?.unit
            ? fmtWithUnit(value, param)
            : fmt(value),
          verdict: getParamStatus(param, value) === "alert" ? "Failed" : "Pass",
        };
      })
      .filter((metric) => metric.value !== null),
  }));

const getLatestMonthLabel = (stations, params, year = 2026) => {
  for (
    let monthIndex = MONTHS_SHORT.length - 1;
    monthIndex >= 0;
    monthIndex -= 1
  ) {
    const hasReading = stations.some((station) =>
      params.some(
        (param) =>
          getMonthlyNumber(getParamData(station, param), monthIndex) !== null,
      ),
    );
    if (hasReading) return `${MONTHS_SHORT[monthIndex]} ${year}`;
  }
  return `Annual ${year}`;
};

const pearson = (pairs) => {
  if (pairs.length < 2) return null;
  const xs = pairs.map(([x]) => x);
  const ys = pairs.map(([, y]) => y);
  const xMean = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const yMean = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  const numerator = pairs.reduce(
    (sum, [x, y]) => sum + (x - xMean) * (y - yMean),
    0,
  );
  const xDen = Math.sqrt(
    xs.reduce((sum, value) => sum + (value - xMean) ** 2, 0),
  );
  const yDen = Math.sqrt(
    ys.reduce((sum, value) => sum + (value - yMean) ** 2, 0),
  );
  if (!xDen || !yDen) return null;
  return numerator / (xDen * yDen);
};

const buildCorrelationMatrix = (stations, params) => {
  const selectedParams = params.slice(0, 6);
  return selectedParams.map((rowParam) => ({
    param: rowParam,
    cells: selectedParams.map((colParam) => {
      const monthlyPairs = stations.flatMap((station) => {
        const rowData = getParamData(station, rowParam);
        const colData = getParamData(station, colParam);
        return Array.from({ length: 12 }, (_, monthIndex) => [
          getMonthlyNumber(rowData, monthIndex),
          getMonthlyNumber(colData, monthIndex),
        ]).filter(([x, y]) => x !== null && y !== null);
      });
      const annualPairs = stations
        .map((station) => [
          getAverageNumber(getParamData(station, rowParam)),
          getAverageNumber(getParamData(station, colParam)),
        ])
        .filter(([x, y]) => x !== null && y !== null);
      const pairs = monthlyPairs.length >= 2 ? monthlyPairs : annualPairs;
      return {
        rowParam,
        colParam,
        value: rowParam === colParam ? 1 : pearson(pairs),
      };
    }),
  }));
};

const getCorrelationColor = (value) => {
  if (value === null) return "rgba(148,163,184,0.18)";
  const intensity = Math.min(Math.abs(value), 1);
  if (value >= 0) return `rgba(68,106,203,${0.16 + intensity * 0.68})`;
  return `rgba(224,123,84,${0.16 + intensity * 0.68})`;
};

const getCorrelationInterpretation = (matrix) => {
  const cells = matrix.flatMap((row) =>
    row.cells.filter(
      (cell) => cell.rowParam !== cell.colParam && cell.value !== null,
    ),
  );

  if (!cells.length) {
    return {
      summary:
        "Not enough paired station values are available to calculate relationships for this waterbody.",
      points: [],
    };
  }

  // Drop mirrored duplicates (A vs B and B vs A are the same relationship).
  const seen = new Set();
  const unique = cells.filter((cell) => {
    const key = [cell.rowParam, cell.colParam].sort().join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const describeStrength = (abs) => {
    if (abs >= 0.8) return "very strong";
    if (abs >= 0.6) return "strong";
    if (abs >= 0.4) return "moderate";
    if (abs >= 0.2) return "weak";
    return "very weak";
  };

  const strongestPositive = unique
    .filter((cell) => cell.value > 0)
    .sort((a, b) => b.value - a.value)[0];
  const strongestNegative = unique
    .filter((cell) => cell.value < 0)
    .sort((a, b) => a.value - b.value)[0];
  const strongCount = unique.filter((cell) => Math.abs(cell.value) >= 0.6).length;

  const points = [];
  if (strongestPositive) {
    points.push(
      `${strongestPositive.rowParam} and ${strongestPositive.colParam} have the closest "rise and fall together" relationship — a ${describeStrength(Math.abs(strongestPositive.value))} positive link (r = ${strongestPositive.value.toFixed(2)}). When one reading goes up, the other usually goes up as well.`,
    );
  }
  if (strongestNegative) {
    points.push(
      `${strongestNegative.rowParam} and ${strongestNegative.colParam} move in opposite directions the most — a ${describeStrength(Math.abs(strongestNegative.value))} inverse link (r = ${strongestNegative.value.toFixed(2)}). As one rises, the other tends to drop.`,
    );
  }
  if (strongCount) {
    points.push(
      `${strongCount} parameter pair${strongCount === 1 ? "" : "s"} show a strong connection (0.6 or higher). These are the relationships most worth watching, since they may point to a shared source or condition affecting both readings.`,
    );
  } else {
    points.push(
      "No pair stands out as strongly connected right now, which suggests these parameters are changing fairly independently of one another.",
    );
  }
  points.push(
    "A strong link does not prove that one parameter causes the other — it only means they tend to change at the same time, so treat it as a clue rather than a conclusion.",
  );

  return {
    summary:
      "This grid measures how strongly each pair of parameters moves together, on a scale from -1 (perfect opposites) to +1 (perfect match). Blue cells mean the two readings rise and fall together, orange cells mean one rises while the other falls, and pale cells mean little or no connection.",
    points,
  };
};

const getObservationMeta = (value) => {
  const text = String(value || "").toLowerCase();
  if (
    /dead|kill|oil|grease|sewage|garbage|trash|foul|odor|black|foam/.test(text)
  ) {
    return {
      label: "Critical",
      status: "critical",
      icon: <IcoAlertTriangle size={16} />,
    };
  }
  if (
    /high\s*tide|low\s*tide|tide|rain|flood|turbid|muddy|construction/.test(
      text,
    )
  ) {
    return {
      label: /high\s*tide/.test(text)
        ? "High Tide"
        : /low\s*tide/.test(text)
          ? "Low Tide"
          : "Watch",
      status: "watch",
      icon: <IcoWaves size={16} />,
    };
  }
  if (/boat|fishing|fishers|vessel|banca/.test(text)) {
    return {
      label: "Boat Activity",
      status: "watch",
      icon: <IcoBoat size={16} />,
    };
  }
  if (/clear|normal|good|stable|none|no /.test(text)) {
    return {
      label: "Good",
      status: "good",
      icon: <IcoCheckCircle size={16} />,
    };
  }
  return { label: "Observed", status: "observed", icon: <IcoEye size={16} /> };
};

const TrendValueLabel = ({
  x,
  y,
  value,
  color,
  seriesIndex = 0,
  pointIndex = 0,
}) => {
  if (!Number.isFinite(value) || x === undefined || y === undefined)
    return null;
  const slots = [
    { dx: -30, dy: -24, anchor: "end" },
    { dx: 30, dy: -24, anchor: "start" },
    { dx: -30, dy: 26, anchor: "end" },
    { dx: 30, dy: 26, anchor: "start" },
  ];
  const slot = slots[(seriesIndex + pointIndex) % slots.length];
  const labelX = x + slot.dx;
  const labelY = y + slot.dy;

  return (
    <g className="trend-value-label">
      <line
        x1={x}
        y1={y}
        x2={labelX}
        y2={labelY}
        stroke={color}
        strokeWidth="1.2"
        strokeDasharray="3 2"
      />
      <circle cx={x} cy={y} r="2" fill={color} />
      <text
        x={labelX}
        y={labelY}
        textAnchor={slot.anchor}
        dominantBaseline="middle"
        fill="var(--text-primary)"
      >
        {fmt(value)}
      </text>
    </g>
  );
};

/* ── Dashboard overview ── */
const DashboardView = () => {
  const { year, sheets, loading, error } = usePublishedWqmDataset();
  // Only surface waterbodies that actually have readings for the published
  // (latest) year. Empty waterbodies are hidden until a reading is added, at
  // which point they reappear automatically (this memo recomputes on update).
  const WATERBODIES = useMemo(() => {
    const options = buildWaterbodyOptions(sheets);
    return options.filter((waterbody) => {
      const sheet = sheets.find((item) => item.key === waterbody.key);
      const stations = getReadableStations(sheet);
      return stations.some((station) => hasNumericReading(station));
    });
  }, [sheets]);
  const groupedWaterbodies = useMemo(
    () => groupWaterbodyByProvince(WATERBODIES),
    [WATERBODIES],
  );
  // The dropdown lists waterbodies grouped/sorted by province, so the first
  // item the user sees is the first grouped entry (e.g. Aurora · Baler Bay),
  // not WATERBODIES[0]. Default the selection to that visible first item.
  const defaultWaterbodyKey =
    groupedWaterbodies[0]?.items?.[0]?.key || WATERBODIES[0]?.key || "";
  const [selectedWaterbody, setSelectedWaterbody] = useState("");
  const [chartParam, setChartParam] = useState(CHART_PARAMS[0]);
  const [paramSlideshow, setParamSlideshow] = useState(false);
  const [selectedObservationMonth, setSelectedObservationMonth] = useState("");
  const [mapStationFilter, setMapStationFilter] = useState("all");
  const [stationLocations, setStationLocations] = useState([]);
  const [profileSettings, setProfileSettings] = useState(
    () => encryptedStorage.getItem("wqms_waterbody_profile_settings") || {},
  );
  const { theme } = useTheme();
  const activeWaterbodyKey = WATERBODIES.some(
    (waterbody) => waterbody.key === selectedWaterbody,
  )
    ? selectedWaterbody
    : defaultWaterbodyKey;

  const sheet = sheets.find((item) => item.key === activeWaterbodyKey);
  const selectedInfo =
    WATERBODIES.find((waterbody) => waterbody.key === activeWaterbodyKey) ||
    WATERBODIES[0];
  const stations = useMemo(() => getReadableStations(sheet), [sheet]);
  const availableParams = useMemo(
    () => getAvailableParams(stations, false),
    [stations],
  );
  const chartParams = useMemo(
    () =>
      availableParams.filter((param) =>
        hasMonthlyParamReading(stations, param),
      ),
    [availableParams, stations],
  );
  const activeParam = chartParams.includes(chartParam)
    ? chartParam
    : chartParams[0] || "";
  const activeUnit = getParamUnit(activeParam);

  // Multi-year historical trend setting
  const { includeHistoricalYears, historicalYears } = useLineChartMergeSettings();
  // All years to display: historicalYears (ascending) + published year at end
  const allTrendYears = useMemo(() => {
    if (!includeHistoricalYears || !historicalYears.length) return [];
    const sorted = [...historicalYears].sort((a, b) => a - b);
    // Ensure published year is at the end (don't duplicate it)
    return sorted.includes(year) ? sorted : [...sorted, year];
  }, [includeHistoricalYears, historicalYears, year]);

  const isMultiYear = allTrendYears.length > 0;

  const { map: allYearSheetsMap } = useAllYearSheets(isMultiYear ? allTrendYears : []);

  const rawStationSeries = useMemo(
    () =>
      stations.map((station, index) => ({
        station,
        chartKey: `station_${index}`,
        color: CHART_COLORS[index % CHART_COLORS.length],
      })),
    [stations],
  );
  // Multi-year mode always uses a single merged line; per-station mode is kept
  // for the single-year view.
  const stationSeries = useMemo(
    () =>
      isMultiYear
        ? [{ station: { stnId: "Historical trend (all stations)" }, chartKey: "merged", color: CHART_COLORS[0] }]
        : rawStationSeries,
    [isMultiYear, rawStationSeries],
  );
  const trendData = useMemo(() => {
    if (!activeParam) return [];
    if (isMultiYear) {
      return buildMultiYearTrend(
        allYearSheetsMap,
        allTrendYears,
        activeWaterbodyKey,
        activeParam,
        MONTHS_SHORT,
        getParamData,
        getMonthlyNumber,
        getReadableStations,
      );
    }
    return buildStationTrendData(rawStationSeries, activeParam);
  }, [activeParam, isMultiYear, allYearSheetsMap, allTrendYears, activeWaterbodyKey, rawStationSeries]);

  // Parameter slideshow: auto-advance the trend chart parameter while playing.
  const slideshowActive = paramSlideshow && chartParams.length >= 4;
  useEffect(() => {
    if (!slideshowActive) return undefined;
    const timer = window.setInterval(() => {
      setChartParam((current) => {
        const index = chartParams.indexOf(current);
        const nextIndex = (index + 1) % chartParams.length;
        return chartParams[nextIndex];
      });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [slideshowActive, chartParams]);

  const gaugeParams = useMemo(
    () =>
      availableParams.filter((param) =>
        stations.some(
          (station) => getLatestNumber(getParamData(station, param)) !== null,
        ),
      ),
    [availableParams, stations],
  );
  const stationGaugeData = useMemo(
    () => buildStationGaugeData(stations, gaugeParams),
    [gaugeParams, stations],
  );
  const gaugeAsOf = useMemo(
    () => getLatestMonthLabel(stations, gaugeParams, year),
    [gaugeParams, stations, year],
  );
  const correlationParams = useMemo(
    () => availableParams.slice(0, 6),
    [availableParams],
  );
  const correlationMatrix = useMemo(
    () => buildCorrelationMatrix(stations, correlationParams),
    [correlationParams, stations],
  );
  const correlationInterpretation = useMemo(
    () => getCorrelationInterpretation(correlationMatrix),
    [correlationMatrix],
  );
  const observations = useMemo(
    () => getObservationEntries(stations),
    [stations],
  );
  const observationMonths = useMemo(
    () =>
      [
        ...new Map(
          [...observations]
            .sort((a, b) => a.monthIndex - b.monthIndex)
            .map((entry) => [entry.month, entry]),
        ).values(),
      ].map((entry) => ({ month: entry.month, monthIndex: entry.monthIndex })),
    [observations],
  );
  const latestObservationMonth =
    observationMonths[observationMonths.length - 1]?.month || "";
  const activeObservationMonth = observationMonths.some(
    (entry) => entry.month === selectedObservationMonth,
  )
    ? selectedObservationMonth
    : latestObservationMonth;
  const filteredObservations = useMemo(
    () =>
      observations.filter(
        (entry) =>
          !activeObservationMonth || entry.month === activeObservationMonth,
      ),
    [activeObservationMonth, observations],
  );
  const lastTrendIndexByKey = useMemo(
    () =>
      stationSeries.reduce((lookup, { chartKey }) => {
        for (let index = trendData.length - 1; index >= 0; index -= 1) {
          if (
            trendData[index][chartKey] !== null &&
            trendData[index][chartKey] !== undefined
          ) {
            lookup[chartKey] = index;
            break;
          }
        }
        return lookup;
      }, {}),
    [stationSeries, trendData],
  );
  const gridColor = theme === "dark" ? "#2d4a6a" : "#E2E8F6";
  const textColor = theme === "dark" ? "#94a3b8" : "#64748b";

  useEffect(() => {
    let cancelled = false;

    const fetchStationLocations = async () => {
      try {
        const locations = await loadStationLocationsCached();
        if (!cancelled) setStationLocations(locations);
      } catch {
        if (!cancelled) setStationLocations([]);
      }
    };

    fetchStationLocations();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handler = (event) => {
      setProfileSettings(
        event.detail ||
          encryptedStorage.getItem("wqms_waterbody_profile_settings") ||
          {},
      );
    };
    window.addEventListener("wqms:waterbody-profile-settings", handler);
    return () =>
      window.removeEventListener("wqms:waterbody-profile-settings", handler);
  }, []);

  const selectedLocations = useMemo(() => {
    if (!selectedInfo) return [];
    // Station-first resolution: only this waterbody's own stations are plotted,
    // each enriched with its full record (for popup metrics), admin coordinate
    // overrides, and a stable id. This prevents stations from other waterbodies
    // bleeding onto the map.
    return resolveWaterbodyMapLocations(
      { key: activeWaterbodyKey, name: selectedInfo?.name, province: selectedInfo?.province },
      stations,
      stationLocations,
      profileSettings,
    );
  }, [
    activeWaterbodyKey,
    selectedInfo,
    stationLocations,
    stations,
    profileSettings,
  ]);

  const activeMapStationFilter =
    mapStationFilter === "all" ||
    selectedLocations.some(
      (location) => String(location.id) === mapStationFilter,
    )
      ? mapStationFilter
      : "all";
  const filteredMapLocations = useMemo(() => {
    if (activeMapStationFilter === "all") return selectedLocations;
    return selectedLocations.filter(
      (location) => String(location.id) === activeMapStationFilter,
    );
  }, [activeMapStationFilter, selectedLocations]);

  const mapCenter = filteredMapLocations[0];
  const mapLink = mapCenter
    ? `https://www.openstreetmap.org/?mlat=${mapCenter.lat}&mlon=${mapCenter.lng}#map=13/${mapCenter.lat}/${mapCenter.lng}`
    : "https://www.openstreetmap.org/";

  if (loading) {
    return (
      <div className="app-loading compact" role="status" aria-live="polite">
        <span />
        Loading WQM {year} dashboard data...
      </div>
    );
  }

  if (error || !sheet) {
    return (
      <div className="map-empty-state">
        {error || `No WQM ${year} dashboard data is available.`}
      </div>
    );
  }

  return (
    <div className="dashboard-overview">
      <section className="dashboard-control-header">
        <div>
          <p className="overview-eyebrow">CY {year} Monitoring Dashboard</p>
          <h2 className="overview-title">
            {selectedInfo?.name || "Waterbody Dashboard"}
          </h2>
          <p className="overview-sub">
            Station trends, field notes, location data, and parameter
            relationships.
          </p>
        </div>
        <div className="dashboard-controls">
          <label>
            <span>Waterbody</span>
            <Select
              className="dashboard-antd-select"
              value={activeWaterbodyKey}
              onChange={(value) => {
                setSelectedWaterbody(value);
                setMapStationFilter("all");
              }}
              showSearch
              optionFilterProp="label"
              popupMatchSelectWidth={false}
              classNames={{ popup: { root: "dashboard-waterbody-dropdown" } }}
              options={groupedWaterbodies.map((group) => ({
                label: group.province,
                options: group.items.map((waterbody) => ({
                  value: waterbody.key,
                  label: waterbody.name,
                })),
              }))}
            />
          </label>
        </div>
      </section>

      <section className="dashboard-summary-strip">
        <div>
          <span className="summary-icon">
            <IcoWater size={16} />
          </span>
          <strong>{stations.length}</strong>
          <span>Stations</span>
        </div>
        <div>
          <span className="summary-icon">
            <IcoTable size={16} />
          </span>
          <strong>{chartParams.length}</strong>
          <span>Chart Parameters</span>
        </div>
        <div>
          <span className="summary-icon">
            <IcoDashboard size={16} />
          </span>
          <strong>{selectedLocations.length || "—"}</strong>
          <span>Mapped Locations</span>
        </div>
        <div>
          <span className="summary-icon">
            <IcoCalendar size={16} />
          </span>
          <strong>{observations.length}</strong>
          <span>Observations</span>
        </div>
      </section>

      <section className="dashboard-primary-grid">
        <article className="chart-card station-trend-card">
          <div className="chart-card-header">
            <div>
              <h3 className="chart-title">
                 Monthly Parameter Summary Trends
              </h3>
              <p className="chart-sub">
                {activeParam} · {selectedInfo?.name}
              </p>
            </div>
            <label className="chart-header-control">
              <span>Parameter</span>
              <div className="chart-param-control-row">
                <Select
                  className="chart-param-antd"
                  value={activeParam}
                  onChange={setChartParam}
                  disabled={!chartParams.length}
                  popupMatchSelectWidth={false}
                  getPopupContainer={(trigger) => trigger.parentElement}
                  style={{ minWidth: 250 }}
                  options={chartParams.map((param) => ({
                    value: param,
                    label: param,
                  }))}
                />
                <Button
                  icon={
                    slideshowActive ? (
                      <PauseCircleOutlined />
                    ) : (
                      <PlayCircleOutlined />
                    )
                  }
                  onClick={() => setParamSlideshow((playing) => !playing)}
                  disabled={chartParams.length < 4}
                  title={
                    slideshowActive
                      ? "Pause parameter slideshow"
                      : "Play parameter slideshow"
                  }
                  aria-label={
                    slideshowActive
                      ? "Pause parameter slideshow"
                      : "Play parameter slideshow"
                  }
                />
              </div>
            </label>
          </div>
          <div className="chart-wrap">
            {trendData.length ? (
              <ResponsiveContainer width="100%" height={340}>
                <AreaChart
                  data={trendData}
                  margin={{ top: 10, right: 16, left: 0, bottom: 8 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={gridColor}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: textColor }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: textColor }}
                    tickLine={false}
                    axisLine={false}
                    width={58}
                    label={
                      activeUnit
                        ? {
                            value: activeUnit,
                            angle: -90,
                            position: "insideLeft",
                            fill: textColor,
                            fontSize: 11,
                          }
                        : undefined
                    }
                  />
                  <Tooltip
                    formatter={(value, name) => [
                      fmtWithUnit(value, activeParam),
                      name,
                    ]}
                  />
                  {stationSeries.map(({ station, chartKey, color }) => (
                    <Area
                      key={chartKey}
                      type="monotone"
                      dataKey={chartKey}
                      name={station.stnId}
                      stroke={color}
                      fill={color}
                      fillOpacity={0.1}
                      strokeWidth={2.2}
                      dot={(dotProps) => {
                        const { cx, cy, index } = dotProps;
                        if (cx === undefined || cy === undefined) return null;
                        const isLatest =
                          lastTrendIndexByKey[chartKey] === index;
                        return (
                          <g>
                            {isLatest && (
                              <circle
                                className="trend-pulse-ring"
                                cx={cx}
                                cy={cy}
                                r="7"
                                fill={color}
                              />
                            )}
                            <circle
                              className={isLatest ? "trend-last-dot" : ""}
                              cx={cx}
                              cy={cy}
                              r={isLatest ? 4.5 : 3}
                              fill={color}
                              stroke="var(--bg-card)"
                              strokeWidth="2"
                            />
                          </g>
                        );
                      }}
                      activeDot={{ r: 6 }}
                      connectNulls
                    >
                      {/* <LabelList
                    dataKey={chartKey}
                    content={(labelProps) => (
                      <TrendValueLabel
                        {...labelProps}
                        color={color}
                        seriesIndex={seriesIndex}
                        pointIndex={labelProps.index || 0}
                      />
                    )}
                  /> */}
                    </Area>
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="map-empty-state">
                No monthly parameter readings are available for this waterbody.
              </div>
            )}
          </div>
        </article>

        <article className="dash-panel map-panel">
          <div className="dash-panel-header">
            <div>
              <h3>Station Location Map</h3>
            </div>
            <a
              className="earth-open-link"
              href={mapLink}
              target="_blank"
              rel="noreferrer"
            >
              Open Map
            </a>
          </div>
          <div className="map-tools">
            <label>
              <Select
                className="dashboard-antd-select"
                value={activeMapStationFilter}
                onChange={setMapStationFilter}
                showSearch
                optionFilterProp="label"
                popupMatchSelectWidth={false}
                getPopupContainer={(trigger) => trigger.parentElement}
                style={{ minWidth: 200 }}
                options={[
                  { value: "all", label: "All mapped stations" },
                  ...selectedLocations.map((location) => ({
                    value: String(location.id),
                    label: `${location.id} - ${location.station || location.barangay || "Station"}`,
                  })),
                ]}
              />
            </label>

            <Button
              type="primary"
              icon={<ReloadOutlined />}
              className="map-reset-btn"
              onClick={() => setMapStationFilter("all")}
            >
              Reset
            </Button>
          </div>
          <Suspense
            fallback={
              <div className="map-empty-state">Loading 3D station map...</div>
            }
          >
            <CesiumStationMap
              className="dashboard-cesium-map"
              locations={filteredMapLocations}
              waterbodyName={selectedInfo?.name || "Waterbody"}
              height={360}
              emptyMessage={`No station coordinates are available for the displayed waterbody${selectedInfo?.name ? ` (${selectedInfo.name})` : ""}.`}
            />
          </Suspense>
          {!!filteredMapLocations.length && (
            <div className="map-legend">
              {filteredMapLocations.map((point, index) => (
                <span key={`${point.id}-legend`}>
                  <i
                    style={{
                      background: CHART_COLORS[index % CHART_COLORS.length],
                    }}
                  />
                  {point.station || point.barangay || "Station"}
                </span>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className="dash-panel station-gauge-panel">
        <div className="dash-panel-header">
          <div>
            <h3>Station Parameter Gauge Metrics</h3>
            <p>
              Latest available readings against reference limits for each
              monitoring station
            </p>
          </div>
          <span className="gauge-as-of">As of {gaugeAsOf}</span>
        </div>
        <div className="station-gauge-table-wrap">
          <table className="station-gauge-table">
            <thead>
              <tr>
                <th>Station</th>
                {gaugeParams.map((param) => (
                  <th key={param}>{param}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stationGaugeData.map(({ station, metrics }) => {
                const metricLookup = Object.fromEntries(
                  metrics.map((metric) => [metric.param, metric]),
                );
                return (
                  <tr key={station.stnId}>
                    <td className="station-gauge-station">
                      <strong>{station.stnId}</strong>
                      <span>{station.address}</span>
                    </td>
                    {gaugeParams.map((param) => {
                      const metric = metricLookup[param];
                      return (
                        <td key={param}>
                          {metric ? (
                            <div
                              className={`rect-gauge status-${metric.status}`}
                            >
                              <div>
                                <strong>{metric.label}</strong>
                                <span
                                  className={`gauge-verdict ${metric.verdict.toLowerCase()}`}
                                >
                                  {metric.unit || metric.verdict}
                                </span>
                              </div>
                              <i style={{ "--pct": `${metric.percent}%` }} />
                            </div>
                          ) : (
                            <span className="gauge-empty">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="dashboard-analysis-grid">
        <article className="dash-panel correlation-panel">
          <div className="dash-panel-header">
            <div>
              <h3>Parameter Correlation</h3>
              <p>
                X and Y axes compare station annual values within{" "}
                {selectedInfo?.name}
              </p>
            </div>
          </div>
          <div className="correlation-wrap">
            <div
              className="correlation-grid"
              style={{ "--corr-size": correlationParams.length }}
            >
              <span className="corr-corner">Y \ X</span>
              {correlationParams.map((param) => (
                <span key={param} className="corr-head" title={param}>
                  {param}
                </span>
              ))}
              {correlationMatrix.map((row) => (
                <Fragment key={row.param}>
                  <span className="corr-row-head" title={row.param}>
                    {row.param}
                  </span>
                  {row.cells.map((cell) => (
                    <span
                      key={`${cell.rowParam}-${cell.colParam}`}
                      className="corr-cell"
                      style={{ background: getCorrelationColor(cell.value) }}
                      title={`${cell.rowParam} vs ${cell.colParam}: ${cell.value === null ? "No data" : cell.value.toFixed(2)}`}
                    >
                      {cell.value === null ? "—" : cell.value.toFixed(2)}
                    </span>
                  ))}
                </Fragment>
              ))}
            </div>
          </div>
          <div className="corr-legend">
            <span>
              <i className="corr-neg" />
              Negative
            </span>
            <span>
              <i className="corr-pos" />
              Positive
            </span>
          </div>
          <div className="corr-interpretation">
            <strong>Interpretation</strong>
            <p>{correlationInterpretation.summary}</p>
            {correlationInterpretation.points.length > 0 && (
              <ul className="corr-interpretation-points">
                {correlationInterpretation.points.map((point, index) => (
                  <li key={index}>{point}</li>
                ))}
              </ul>
            )}
          </div>
        </article>

        <article className="dash-panel observation-panel observation-panel-side">
          <div className="dash-panel-header">
            <div>
              <h3>Observation Panel</h3>
              <p>Field notes recorded for {selectedInfo?.name}</p>
            </div>
            <Select
              className="observation-month-filter"
              value={activeObservationMonth || undefined}
              onChange={setSelectedObservationMonth}
              popupMatchSelectWidth={false}
              getPopupContainer={(trigger) => trigger.parentElement}
              style={{ minWidth: 110 }}
              options={observationMonths.map((entry) => ({
                value: entry.month,
                label: entry.month,
              }))}
            />
          </div>
          <div className="observation-list observation-list-side">
            {filteredObservations.length ? (
              filteredObservations.map((entry) => (
                <article
                  key={`${entry.station.stnId}-${entry.month}`}
                  className={`observation-item status-${getObservationMeta(entry.value).status}`}
                >
                  <span className="observation-icon">
                    {getObservationMeta(entry.value).icon}
                  </span>
                  <div>
                    <strong>
                      {entry.month} · {entry.station.stnId}
                    </strong>
                    <span className="observation-status-label">
                      {getObservationMeta(entry.value).label}
                    </span>
                    <p>{entry.value}</p>
                  </div>
                </article>
              ))
            ) : (
              <div className="map-empty-state">
                No observations are available for this filter.
              </div>
            )}
          </div>
        </article>
      </section>
    </div>
  );
};

const VISUALIZATION_ITEMS = [
  ["heatmap", "Heatmap Matrix", IcoTable],
  ["fecal-trophic", "Fecal Risk & Trophic State", IcoMapPin],
  ["seasonal", "Seasonal Decomposition", IcoCalendar],
  ["radar", "Radar Chart", IcoDashboard],
  ["scatter", "Scatter Analysis", IcoWaves],
  ["forecast", "Forecast Charts", IcoAlertTriangle],
];

const ACCESS_ROLE_RANK = { user: 1, developer: 2, admin: 3 };
const DEFAULT_ACCESS_SETTINGS = {
  dashboard: "user",
  visualizations: "user",
  waterbodies: "user",
  tabular: "user",
  developerManager: "developer",
  settings: "developer",
};

const getStoredAccessSettings = () => {
  try {
    return {
      ...DEFAULT_ACCESS_SETTINGS,
      ...(encryptedStorage.getItem("wqms_access_settings") || {}),
    };
  } catch {
    return DEFAULT_ACCESS_SETTINGS;
  }
};

const getStoredUserAccess = () => {
  try {
    return encryptedStorage.getItem("wqms_user_access") || {};
  } catch {
    return {};
  }
};

/* ── Year placeholder ── */
const YearPlaceholder = ({ year }) => (
  <div className="wqm-placeholder">
    <svg
      width="48"
      height="48"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      style={{
        color: "var(--text-secondary)",
        marginBottom: "1rem",
        opacity: 0.4,
      }}
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
    <h3>No Data Available &mdash; {year}</h3>
    <p>Water quality data for CY {year} has not been uploaded yet.</p>
  </div>
);

/* ── Main Home layout ── */
const Home = () => {
  const { user, logout } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const navigate = useNavigate();
  const userMenuRef = useRef(null);

  const [activeView, setActiveView] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [tabularOpen, setTabularOpen] = useState(false);
  const [newYearOpen, setNewYearOpen] = useState(false);
  const [waterbodiesOpen, setWaterbodiesOpen] = useState(false);
  const [visualizationsOpen, setVisualizationsOpen] = useState(false);
  const [developerOpen, setDeveloperOpen] = useState(false);
  const [developerSection, setDeveloperSection] = useState("accounts");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState("waterbody-settings");
  const [activeVisualization, setActiveVisualization] = useState("heatmap");
  const [activeWaterbody, setActiveWaterbody] = useState(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [accessSettings, setAccessSettings] = useState(getStoredAccessSettings);
  const [userAccess, setUserAccess] = useState(getStoredUserAccess);
  const { year: publishedYear, sheets: monitoringSheets } =
    usePublishedWqmDataset();
  const tabularYears = useTabularYears();
  const localSheets = useWqmSheets();
  const waterbodies = useMemo(
    () => buildWaterbodyOptions(monitoringSheets),
    [monitoringSheets],
  );

  useEffect(() => {
    const handler = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    const refreshAccess = () => {
      setAccessSettings(getStoredAccessSettings());
      setUserAccess(getStoredUserAccess());
    };
    window.addEventListener("storage", refreshAccess);
    window.addEventListener("wqms:access-settings", refreshAccess);
    return () => {
      window.removeEventListener("storage", refreshAccess);
      window.removeEventListener("wqms:access-settings", refreshAccess);
    };
  }, []);

  const canAccess = (feature) => {
    const override = userAccess?.[user?._id]?.[feature];
    if (override === "allow") return true;
    if (override === "deny") return false;
    return (
      (ACCESS_ROLE_RANK[user?.role] || 0) >=
      (ACCESS_ROLE_RANK[accessSettings[feature] || "user"] || 1)
    );
  };

  // Map an active view to the access feature that controls it, so the rendered
  // content (not just the nav) respects Manage Access changes immediately.
  const viewFeature = (view) => {
    if (view === "dashboard") return "dashboard";
    if (view.startsWith("tabular")) return "tabular";
    if (view === "waterbody") return "waterbodies";
    if (view === "developer-manager") return "developerManager";
    if (view === "settings") return "settings";
    if (view === "visualization") {
      return activeVisualization === "map-3d" ? "waterbodies" : "visualizations";
    }
    return null;
  };
  const hasViewAccess = (view) => {
    const feature = viewFeature(view);
    return !feature || canAccess(feature);
  };

  // If the current view becomes inaccessible (admin revoked access live), fall
  // back to the first feature the user can still open.
  useEffect(() => {
    if (hasViewAccess(activeView)) return;
    const fallbackOrder = [
      ["dashboard", "dashboard"],
      ["visualizations", "visualization"],
      ["tabular", "tabular-2026"],
    ];
    const next = fallbackOrder.find(([feature]) => canAccess(feature));
    queueMicrotask(() => setActiveView(next ? next[1] : "dashboard"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessSettings, userAccess, activeView, activeVisualization]);

  const nav = (view) => {
    setActiveView(view);
    if (!view.startsWith("tabular")) setTabularOpen(false);
    logActivity("Navigated app view", { view }, user);
  };

  const navWaterbody = (key) => {
    setActiveWaterbody(key);
    setActiveView("waterbody");
  };

  const navDeveloper = (section) => {
    setDeveloperSection(section);
    setActiveView("developer-manager");
    logActivity("Opened developer manager section", { section }, user);
  };

  const navSettings = (section) => {
    setSettingsSection(section);
    setActiveView("settings");
    logActivity("Opened settings section", { section }, user);
  };

  const navVisualization = (section) => {
    setActiveVisualization(section);
    setActiveView("visualization");
    logActivity("Opened visualization", { section }, user);
  };

  const handleLogout = () => {
    logActivity("Signed out", {}, user);
    logout();
    navigate("/login");
  };

  const pageTitle =
    {
      dashboard: "Dashboard",
      "developer-manager": "Developer Manager",
      settings: "Settings",
      visualization:
        activeVisualization === "map-3d"
          ? "3D Waterbody Map"
          : "Visual Analytics",
      waterbody:
        waterbodies.find((w) => w.key === activeWaterbody)?.name ||
        "Waterbody Profile",
    }[activeView] ||
    (activeView.startsWith("tabular-")
      ? `Tabular Results — ${activeView.replace("tabular-", "")}`
      : "Dashboard");
  const hideTopbar = activeView.startsWith("tabular");

  return (
    <div className={`dashboard${sidebarCollapsed ? " is-collapsed" : ""}`}>
      {/* ── Mobile sidebar backdrop ── */}
      {sidebarOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      {/* ── Sidebar ── */}
      <aside
        className={`sidebar${sidebarOpen ? " sidebar-mobile-open" : ""}${sidebarCollapsed ? " collapsed" : ""}`}
        onClick={(e) => {
          if (
            window.innerWidth <= 480 &&
            (e.target.closest("button.nav-item") ||
              e.target.closest(".theme-toggle-sidebar"))
          )
            setSidebarOpen(false);
        }}
      >
        <button
          type="button"
          className="sidebar-collapse-toggle"
          onClick={() => setSidebarCollapsed((v) => !v)}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <IcoChevronRight size={15} />
        </button>
        <div className="sidebar-brand">
          <div className="sidebar-logos">
            <img
              src={bagongLogo}
              alt="Bagong Pilipinas"
              className="logo-bagong"
            />
            <div className="sidebar-logo-divider" />
            <img src={embLogo} alt="EMB" className="logo-emb" />
          </div>
          <div className="sidebar-brand-text">
            <span className="sidebar-brand-name">
              Environmental Management Bureau
            </span>
            <span className="sidebar-brand-sub">Region III</span>
            <span className="sidebar-brand-system">
              Water Quality Monitoring System
            </span>
          </div>
        </div>

        <nav className="sidebar-nav">
          <p className="nav-section-label">Main</p>

          {canAccess("dashboard") && (
            <button
              className={`nav-item${activeView === "dashboard" ? " active" : ""}`}
              onClick={() => nav("dashboard")}
            >
              <IcoDashboard size={15} />
              <span className="nav-label">Dashboard</span>
            </button>
          )}

          {canAccess("visualizations") && (
            <button
              className={`nav-item nav-group-toggle${visualizationsOpen || (activeView === "visualization" && activeVisualization !== "map-3d") ? " open" : ""}`}
              onClick={() => setVisualizationsOpen((open) => !open)}
            >
              <IcoDashboard size={15} />
              <span className="nav-label">Visualizations</span>
              <span className="nav-chevron-icon">
                {visualizationsOpen ? (
                  <IcoChevronDown size={12} />
                ) : (
                  <IcoChevronRight size={12} />
                )}
              </span>
            </button>
          )}

          {canAccess("visualizations") && visualizationsOpen && (
            <div className="nav-sub-group">
              {VISUALIZATION_ITEMS.map(
                ([section, label, VisualizationIcon]) => (
                  <button
                    key={section}
                    className={`nav-item nav-sub-item${activeView === "visualization" && activeVisualization === section ? " active" : ""}`}
                    onClick={() => navVisualization(section)}
                  >
                    {VisualizationIcon({ size: 12 })}
                    <span className="nav-label">{label}</span>
                  </button>
                ),
              )}
            </div>
          )}

          <p className="nav-section-label">Monitoring</p>

          {canAccess("waterbodies") && (
            <button
              className={`nav-item${activeView === "visualization" && activeVisualization === "map-3d" ? " active" : ""}`}
              onClick={() => navVisualization("map-3d")}
            >
              <IcoMapPin size={15} />
              <span className="nav-label">3D Waterbody Map</span>
            </button>
          )}

          <p className="nav-section-label">Data</p>
          {canAccess("waterbodies") && (
            <button
              className={`nav-item nav-group-toggle${waterbodiesOpen ? " open" : ""}`}
              onClick={() => setWaterbodiesOpen((o) => !o)}
            >
              <IcoWater size={15} />
              <span className="nav-label">Waterbody Profiles</span>
              <span className="nav-chevron-icon">
                {waterbodiesOpen ? (
                  <IcoChevronDown size={12} />
                ) : (
                  <IcoChevronRight size={12} />
                )}
              </span>
            </button>
          )}

          {canAccess("waterbodies") && waterbodiesOpen && (
            <div className="nav-sub-group nav-wb-group">
              {waterbodies.map((wb) => (
                <button
                  key={wb.key}
                  className={`nav-item nav-sub-item${activeView === "waterbody" && activeWaterbody === wb.key ? " active" : ""}`}
                  onClick={() => navWaterbody(wb.key)}
                >
                  <span className="nav-wb-dot" />
                  <span className="nav-label">{wb.name}</span>
                </button>
              ))}
            </div>
          )}

          {canAccess("tabular") && (
            <button
              className={`nav-item nav-group-toggle${tabularOpen || activeView.startsWith("tabular") ? " open" : ""}`}
              onClick={() => setTabularOpen((o) => !o)}
            >
              <IcoTable size={15} />
              <span className="nav-label">Tabular Results</span>
              <span className="nav-chevron-icon">
                {tabularOpen ? (
                  <IcoChevronDown size={12} />
                ) : (
                  <IcoChevronRight size={12} />
                )}
              </span>
            </button>
          )}

          {canAccess("tabular") && tabularOpen && (
            <div className="nav-sub-group">
              {tabularYears.map((yr) => (
                <button
                  key={yr}
                  className={`nav-item nav-sub-item${activeView === `tabular-${yr}` ? " active" : ""}`}
                  onClick={() => nav(`tabular-${yr}`)}
                >
                  <IcoCalendar size={12} />
                  <span className="nav-label">{yr}</span>
                </button>
              ))}
              {["admin", "developer"].includes(user?.role) && (
                <button
                  className="nav-item nav-sub-item nav-sub-add"
                  onClick={() => setNewYearOpen(true)}
                >
                  <IcoCalendar size={12} />
                  <span className="nav-label">+ New Year</span>
                </button>
              )}
            </div>
          )}

          {["admin", "developer"].includes(user?.role) &&
            canAccess("developerManager") && (
              <>
                <p className="nav-section-label">System</p>
                <button
                  className={`nav-item nav-group-toggle${developerOpen || activeView === "developer-manager" ? " open" : ""}`}
                  onClick={() => setDeveloperOpen((open) => !open)}
                >
                  <IcoSettings size={15} />
                  <span className="nav-label">Developer Manager</span>
                  <span className="nav-badge-admin">
                    {user?.role === "developer" ? "dev" : "admin"}
                  </span>
                  <span className="nav-chevron-icon">
                    {developerOpen ? (
                      <IcoChevronDown size={12} />
                    ) : (
                      <IcoChevronRight size={12} />
                    )}
                  </span>
                </button>
                {developerOpen && (
                  <div className="nav-sub-group">
                    {[
                      ["accounts", "Account Management"],
                      ["runtime", "Runtime & Database"],
                      ["chart-config", "Chart Configuration"],
                      ["logs", "App Logs"],
                      ["backup", "Backup, Data & Email"],
                    ].map(([section, label]) => (
                      <button
                        key={section}
                        className={`nav-item nav-sub-item${activeView === "developer-manager" && developerSection === section ? " active" : ""}`}
                        onClick={() => navDeveloper(section)}
                      >
                        <span className="nav-wb-dot" />
                        <span className="nav-label">{label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

          {["admin", "developer"].includes(user?.role) &&
            canAccess("settings") && (
              <>
                <p className="nav-section-label">Settings</p>
                <button
                  className={`nav-item nav-group-toggle${settingsOpen || activeView === "settings" ? " open" : ""}`}
                  onClick={() => setSettingsOpen((open) => !open)}
                >
                  <IcoSettings size={15} />
                  <span className="nav-label">Settings</span>
                  <span className="nav-chevron-icon">
                    {settingsOpen ? (
                      <IcoChevronDown size={12} />
                    ) : (
                      <IcoChevronRight size={12} />
                    )}
                  </span>
                </button>
                {settingsOpen && (
                  <div className="nav-sub-group">
                    {[
                      ["waterbody-settings", "Waterbody Profiles & Station Locations"],
                      ["linechart", "Line Chart Data"],
                      ["ai", "AI Forecast"],
                    ].map(([section, label]) => (
                      <button
                        key={section}
                        className={`nav-item nav-sub-item${activeView === "settings" && settingsSection === section ? " active" : ""}`}
                        onClick={() => navSettings(section)}
                      >
                        <span className="nav-wb-dot" />
                        <span className="nav-label">{label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
        </nav>

        <div
          className="theme-toggle-sidebar"
          onClick={toggleTheme}
          role="button"
          tabIndex={0}
          title="Toggle theme"
        >
          {theme === "light" ? <IcoSun size={14} /> : <IcoMoon size={14} />}
          <span className="nav-label">
            {theme === "light" ? "Light Mode" : "Dark Mode"}
          </span>
          <span className={`tts-track${theme === "dark" ? " on" : ""}`}>
            <span className="tts-knob" />
          </span>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="main-content">
        {!hideTopbar && (
          <header
            className={`topbar${activeView === "dashboard" ? " dashboard-header" : ""}`}
          >
            <div className="topbar-left">
              <button
                className="sidebar-hamburger"
                onClick={() => setSidebarOpen((v) => !v)}
                aria-label="Toggle navigation"
              >
                <IcoMenu size={20} />
              </button>
              <h2 className="page-title">{pageTitle}</h2>
              <p className="page-subtitle">
                EMBR3 Water Quality Monitoring System &middot; Region III
              </p>
            </div>
            <div className="topbar-right">
              <div className="last-updated">
                <span className="pulse-dot" />
                EMBR3-WQMS
              </div>
              <div className="user-menu-wrap" ref={userMenuRef}>
                <button
                  className="avatar"
                  onClick={() => setShowUserMenu((v) => !v)}
                  title={user?.name}
                >
                  {user?.name?.charAt(0).toUpperCase()}
                </button>
                {showUserMenu && (
                  <div className="user-dropdown">
                    <div className="ud-header">
                      <span className="ud-avatar-lg">
                        {user?.name?.charAt(0).toUpperCase()}
                      </span>
                      <div className="ud-info">
                        <p className="ud-name">{user?.name}</p>
                        <p className="ud-email">{user?.email}</p>
                        <span className="ud-role-badge">{user?.role}</span>
                      </div>
                    </div>
                    <div className="ud-divider" />
                    <button
                      className="ud-item ud-logout"
                      onClick={handleLogout}
                    >
                      <IcoLogout size={14} />
                      Sign Out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </header>
        )}

        <div className="content-area">
          {!hasViewAccess(activeView) ? (
            <div className="settings-denied">
              <span className="denied-icon">!</span>
              <h3>Access Restricted</h3>
              <p>
                Your account does not have permission to open this section.
                Contact an administrator if you believe this is an error.
              </p>
            </div>
          ) : (
            <>
              {activeView === "dashboard" && <DashboardView />}
              {activeView.startsWith("tabular-") &&
                tabularYears.includes(Number(activeView.replace("tabular-", ""))) && (
                  <WQM2026
                    key={activeView}
                    year={Number(activeView.replace("tabular-", ""))}
                    onYearDeleted={() => nav("tabular-2026")}
                  />
                )}
              {activeView === "visualization" &&
                (activeVisualization === "map-3d" ? (
                  <Suspense
                    fallback={
                      <div className="app-loading compact">
                        <span />
                        Loading 3D waterbody map...
                      </div>
                    }
                  >
                    <Waterbody3DMap />
                  </Suspense>
                ) : (
                  <Suspense
                    fallback={
                      <div className="app-loading compact">
                        <span />
                        Loading visual analytics...
                      </div>
                    }
                  >
                    <VisualizationView type={activeVisualization} />
                  </Suspense>
                ))}
              {activeView === "developer-manager" && (
                <Settings
                  key={developerSection}
                  initialSection={developerSection}
                />
              )}
              {activeView === "settings" && (
                <Settings
                  key={settingsSection}
                  initialSection={settingsSection}
                />
              )}
              {activeView === "waterbody" && activeWaterbody && (
                <WaterbodyProfile
                  waterbodyKey={activeWaterbody}
                  year={publishedYear}
                  sheets={monitoringSheets}
                />
              )}
            </>
          )}
        </div>
        <footer className="app-footer">
          <span>EMBR3 Water Quality Monitoring System</span>
          <span>
            Environmental Management Bureau Region III · CY {publishedYear}
          </span>
        </footer>
      </main>

      <NewMonitoringYearModal
        open={newYearOpen}
        onClose={() => setNewYearOpen(false)}
        sourceSheets={localSheets}
        onCreated={(yr) => nav(`tabular-${yr}`)}
      />
    </div>
  );
};

export default Home;

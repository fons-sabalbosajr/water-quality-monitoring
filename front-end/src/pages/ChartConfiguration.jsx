import { useMemo, useState } from 'react';
import { Button, Empty, Modal, Select, Table, Tag } from 'antd';
import { LineChartOutlined } from '@ant-design/icons';
import {
  Area, AreaChart, CartesianGrid, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  MONTHS_SHORT, OBSERVATION_PARAM, PARAM_LIMITS, fmt, fmtWithUnit,
  getAvailableParams, getMonthlyNumber, getParamData, getParamUnit,
} from '../utils/wqmData';
import {
  buildWaterbodyOptions, getReadableStations, groupWaterbodyByProvince,
  useWqmSheets, useAllYearSheets, WQM_YEAR_OPTIONS,
} from '../utils/wqmSheets';
import {
  buildStationMultiYearSeries, matchStationAcrossYears, forecastNextMonth,
} from '../utils/lineChartSettings';
import { logActivity } from '../utils/appLog';
import { useAuth } from '../context/AuthContext';
import './ChartConfiguration.css';

const FORECAST_COLOR = '#f59e0b';
const PARAM_COLORS = ['#446ACB', '#7CB675', '#e07b54', '#a78bfa', '#06b6d4', '#ec4899', '#84cc16', '#f59e0b'];
const ALL_YEARS = [...WQM_YEAR_OPTIONS].sort((a, b) => a - b); // [2024, 2025, 2026]

const getStationKey = (station) => String(station?.stnNo ?? station?.stnId ?? '');

// Month label that immediately follows a given { year, monthIndex } point.
const nextMonthLabel = (point) => {
  if (!point) return '';
  const next = (point.monthIndex + 1) % 12;
  const yr = point.monthIndex === 11 ? point.year + 1 : point.year;
  return `${MONTHS_SHORT[next]} ${yr}`;
};

// Drop leading/trailing all-null months so the chart starts/ends on real data.
const trimNullEdges = (points) => {
  let start = 0;
  let end = points.length - 1;
  while (start <= end && (points[start].value === null || points[start].value === undefined)) start += 1;
  while (end >= start && (points[end].value === null || points[end].value === undefined)) end -= 1;
  return start <= end ? points.slice(start, end + 1) : [];
};

const ChartConfiguration = () => {
  const { user } = useAuth();
  const latestSheets = useWqmSheets(); // 2026 (latest) drives the picker options

  const [selectedYears, setSelectedYears] = useState(ALL_YEARS);
  const allYearsSorted = useMemo(() => [...selectedYears].sort((a, b) => a - b), [selectedYears]);
  const { map: allYearSheets, loading } = useAllYearSheets(selectedYears);

  const waterbodyOptions = useMemo(() => buildWaterbodyOptions(latestSheets), [latestSheets]);
  const groupedWaterbodies = useMemo(() => groupWaterbodyByProvince(waterbodyOptions), [waterbodyOptions]);
  const defaultWaterbodyKey = groupedWaterbodies[0]?.items?.[0]?.key || waterbodyOptions[0]?.key || '';

  const [waterbodyKey, setWaterbodyKey] = useState('');
  const activeWaterbodyKey = waterbodyOptions.some((w) => w.key === waterbodyKey)
    ? waterbodyKey
    : defaultWaterbodyKey;

  const latestSheet = latestSheets.find((s) => s.key === activeWaterbodyKey);
  const stations = useMemo(() => getReadableStations(latestSheet), [latestSheet]);

  const [stationKey, setStationKey] = useState('');
  const activeStation = stations.find((s) => getStationKey(s) === stationKey) || stations[0];
  const activeStationKey = getStationKey(activeStation);

  const [detailParam, setDetailParam] = useState(null);

  // Candidate parameters: union of all numeric params reported by the matched
  // station across every selected year.
  const paramCards = useMemo(() => {
    if (!activeStation) return [];

    // Collect candidate params from the matched station across the selected years.
    const candidateSet = new Set();
    allYearsSorted.forEach((yr) => {
      const sheets = allYearSheets.get(yr) || [];
      const sheet = sheets.find((s) => s.key === activeWaterbodyKey);
      const yrStations = getReadableStations(sheet);
      const matched = matchStationAcrossYears(yrStations, activeStation);
      if (matched) {
        getAvailableParams([matched], false).forEach((p) => {
          if (p !== OBSERVATION_PARAM) candidateSet.add(p);
        });
      }
    });

    const cards = [];
    [...candidateSet].forEach((param, index) => {
      const series = buildStationMultiYearSeries(
        allYearSheets, allYearsSorted, activeWaterbodyKey, activeStation, param,
        MONTHS_SHORT, getParamData, getMonthlyNumber, getReadableStations,
      );
      const trimmed = trimNullEdges(series);
      const observed = trimmed.filter((p) => p.value !== null && p.value !== undefined);
      if (observed.length < 1) return;

      const lastObserved = observed[observed.length - 1];
      const fc = forecastNextMonth(trimmed.map((p) => p.value), param);

      let data = trimmed.map((p) => ({ label: p.label, value: p.value }));
      let forecastLabel = '';
      if (fc && lastObserved) {
        forecastLabel = nextMonthLabel(lastObserved);
        data = data.map((d) => (
          d.label === lastObserved.label
            ? { ...d, forecast: lastObserved.value, lower: lastObserved.value, upper: lastObserved.value }
            : d
        ));
        data = [...data, {
          label: forecastLabel,
          forecast: fc.value,
          lower: fc.lower,
          upper: fc.upper,
          isForecast: true,
        }];
      }

      cards.push({
        param,
        color: PARAM_COLORS[index % PARAM_COLORS.length],
        unit: getParamUnit(param),
        data,
        observed,
        trimmed,
        forecast: fc,
        forecastLabel,
        monthsCount: observed.length,
      });
    });
    return cards;
  }, [activeStation, activeWaterbodyKey, allYearSheets, allYearsSorted]);

  const handleOpenDetail = (card) => {
    setDetailParam(card);
    logActivity('Opened chart configuration detail', {
      waterbody: activeWaterbodyKey,
      station: activeStationKey,
      param: card.param,
      years: allYearsSorted,
    }, user);
  };

  const buildInterpretation = (card) => {
    if (!card.forecast) {
      return `Not enough monthly data for ${card.param} at ${activeStation?.stnId} to project a forecast yet.`;
    }
    const { trend, value, lower, upper, confidence } = card.forecast;
    const unit = card.unit ? ` ${card.unit}` : '';
    const limit = PARAM_LIMITS[card.param];
    let compliance = '';
    if (limit) {
      if (limit.max !== undefined && value > limit.max) {
        compliance = ` This is above the guideline limit of ${limit.max}${unit}, so it warrants close monitoring.`;
      } else if (limit.min !== undefined && value < limit.min) {
        compliance = ` This is below the guideline minimum of ${limit.min}${unit}, so it warrants close monitoring.`;
      } else {
        compliance = ' This stays within the water quality guideline.';
      }
    }
    const trendWord = trend === 'increasing'
      ? 'trending upward'
      : trend === 'decreasing'
        ? 'trending downward'
        : 'holding fairly steady';
    return `Across ${card.monthsCount} monthly readings from ${allYearsSorted.join(', ')}, ${card.param} at ${activeStation?.stnId} is ${trendWord}. Next month (${card.forecastLabel}) is projected at about ${fmt(value)}${unit} (likely between ${fmt(lower)} and ${fmt(upper)}${unit}), with a model fit of ${confidence}%.${compliance}`;
  };

  return (
    <div className="chart-config">
      <div className="cc-toolbar">
        <label className="cc-field">
          <span>Waterbody</span>
          <Select
            value={activeWaterbodyKey}
            onChange={(value) => {
              setWaterbodyKey(value);
              setStationKey('');
              logActivity('Viewed chart configuration waterbody', { waterbody: value, years: allYearsSorted }, user);
            }}
            showSearch
            optionFilterProp="label"
            popupMatchSelectWidth={false}
            style={{ minWidth: 220 }}
            options={groupedWaterbodies.map((group) => ({
              label: group.province,
              options: group.items.map((wb) => ({ value: wb.key, label: wb.name })),
            }))}
          />
        </label>

        <label className="cc-field">
          <span>Station</span>
          <Select
            value={activeStationKey}
            onChange={setStationKey}
            showSearch
            optionFilterProp="label"
            popupMatchSelectWidth={false}
            style={{ minWidth: 200 }}
            options={stations.map((station) => ({
              value: getStationKey(station),
              label: `${station.stnId}${station.address ? ` · ${station.address}` : ''}`,
            }))}
          />
        </label>

        <label className="cc-field">
          <span>Years to merge</span>
          <Select
            mode="multiple"
            value={selectedYears}
            onChange={(value) => setSelectedYears(value.length ? value : ALL_YEARS)}
            options={ALL_YEARS.map((yr) => ({ value: yr, label: String(yr) }))}
            style={{ minWidth: 200 }}
          />
        </label>

        <Tag icon={<LineChartOutlined />} color="blue" className="cc-years-tag">
          {allYearsSorted.join(' → ')}
        </Tag>
      </div>

      <p className="cc-help">
        Each chart shows one parameter for the selected station, with its monthly
        readings stitched together across {allYearsSorted.join(', ')} (the same
        station is matched in every year). A one-month forecast is appended to
        each line. Click a chart to view the full readings table.
      </p>

      {loading ? (
        <div className="cc-loading">Loading historical readings…</div>
      ) : !activeStation ? (
        <Empty description="This waterbody has no monitoring stations." />
      ) : paramCards.length === 0 ? (
        <Empty description="No monthly parameter readings are available for this station in the selected years." />
      ) : (
        <div className="cc-rows">
          {paramCards.map((card) => (
            <article
              key={card.param}
              className="cc-row"
              role="button"
              tabIndex={0}
              title="Click to open full readings table"
              onClick={() => handleOpenDetail(card)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handleOpenDetail(card);
                }
              }}
              style={{ '--cc-accent': card.color }}
            >
              <div className="cc-row-head">
                <div>
                  <h4>{card.param}</h4>
                  <span className="cc-row-sub">
                    {activeStation.stnId} · {card.monthsCount} readings
                    {card.forecast ? ` · next: ${fmt(card.forecast.value)}${card.unit ? ` ${card.unit}` : ''} (${card.forecast.trend})` : ''}
                  </span>
                </div>
                {card.forecast && (
                  <Tag color={card.forecast.trend === 'increasing' ? 'red' : card.forecast.trend === 'decreasing' ? 'green' : 'blue'}>
                    {card.forecast.trend}
                  </Tag>
                )}
              </div>

              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={card.data} margin={{ top: 6, right: 12, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id={`cc-${card.param.replace(/\W/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={card.color} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={card.color} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis tick={{ fontSize: 10 }} width={42} />
                  <Tooltip
                    formatter={(value, name) => [fmtWithUnit(value, card.param), name]}
                    contentStyle={{ fontSize: 11, borderRadius: 8 }}
                  />
                  <Area
                    dataKey="value"
                    name="Observed"
                    stroke={card.color}
                    strokeWidth={2}
                    fill={`url(#cc-${card.param.replace(/\W/g, '')})`}
                    connectNulls
                    isAnimationActive
                    animationDuration={700}
                  />
                  <Line dataKey="upper" name="Upper" stroke={FORECAST_COLOR} strokeOpacity={0.35} strokeDasharray="2 3" dot={false} isAnimationActive={false} />
                  <Line dataKey="lower" name="Lower" stroke={FORECAST_COLOR} strokeOpacity={0.35} strokeDasharray="2 3" dot={false} isAnimationActive={false} />
                  <Line
                    dataKey="forecast"
                    name="Forecast"
                    stroke={FORECAST_COLOR}
                    strokeWidth={2.4}
                    strokeDasharray="6 4"
                    dot={(p) => {
                      const { cx, cy, payload } = p;
                      if (cx === undefined || cy === undefined || !payload?.isForecast) return null;
                      return (
                        <g key={`${card.param}-fc`}>
                          <circle className="cc-fc-dot" cx={cx} cy={cy} r="5" fill={FORECAST_COLOR} />
                          <circle cx={cx} cy={cy} r="2.6" fill={FORECAST_COLOR} stroke="var(--bg-card)" strokeWidth="1.4" />
                        </g>
                      );
                    }}
                    isAnimationActive
                    animationDuration={900}
                  />
                </AreaChart>
              </ResponsiveContainer>

              <p className="cc-interpretation">{buildInterpretation(card)}</p>
            </article>
          ))}
        </div>
      )}

      <Modal
        className="cc-detail-modal"
        open={Boolean(detailParam)}
        onCancel={() => setDetailParam(null)}
        width="min(880px, 96vw)"
        destroyOnHidden
        title={detailParam ? `${detailParam.param} · ${activeStation?.stnId}` : ''}
        footer={<Button onClick={() => setDetailParam(null)}>Close</Button>}
      >
        {detailParam && (
          <div className="cc-detail-body">
            <p className="cc-interpretation cc-detail-interp">{buildInterpretation(detailParam)}</p>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={detailParam.data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={20} angle={-20} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 11 }} width={48} />
                <Tooltip formatter={(value, name) => [fmtWithUnit(value, detailParam.param), name]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: '0.72rem' }} />
                <Area dataKey="value" name="Observed" stroke={detailParam.color} strokeWidth={2} fillOpacity={0.12} fill={detailParam.color} connectNulls />
                <Line dataKey="upper" name="Upper band" stroke={FORECAST_COLOR} strokeOpacity={0.4} strokeDasharray="2 3" dot={false} />
                <Line dataKey="lower" name="Lower band" stroke={FORECAST_COLOR} strokeOpacity={0.4} strokeDasharray="2 3" dot={false} />
                <Line dataKey="forecast" name="Forecast" stroke={FORECAST_COLOR} strokeWidth={2.4} strokeDasharray="6 4" dot={{ r: 2.5, fill: FORECAST_COLOR }} />
              </AreaChart>
            </ResponsiveContainer>

            <Table
              className="cc-detail-table"
              size="small"
              rowKey="key"
              pagination={false}
              scroll={{ y: 280 }}
              dataSource={[
                ...detailParam.trimmed
                  .filter((p) => p.value !== null && p.value !== undefined)
                  .map((p, i) => ({ key: `o${i}`, label: p.label, type: 'Observed', value: p.value })),
                ...(detailParam.forecast
                  ? [{
                    key: 'forecast',
                    label: detailParam.forecastLabel,
                    type: 'Forecast',
                    value: detailParam.forecast.value,
                    lower: detailParam.forecast.lower,
                    upper: detailParam.forecast.upper,
                  }]
                  : []),
              ]}
              columns={[
                { title: 'Month', dataIndex: 'label', key: 'label' },
                {
                  title: 'Type',
                  dataIndex: 'type',
                  key: 'type',
                  render: (value) => <Tag color={value === 'Forecast' ? 'gold' : 'blue'}>{value}</Tag>,
                },
                { title: 'Value', dataIndex: 'value', key: 'value', render: (value) => fmtWithUnit(value, detailParam.param) },
                {
                  title: 'Range',
                  key: 'range',
                  render: (_, row) => (row.lower === undefined ? '—' : `${fmt(row.lower)} – ${fmt(row.upper)}`),
                },
              ]}
            />
          </div>
        )}
      </Modal>
    </div>
  );
};

export default ChartConfiguration;

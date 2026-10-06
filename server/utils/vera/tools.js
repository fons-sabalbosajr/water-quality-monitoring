// VERA tools — every figure VERA reports is computed here from the stored WQM
// years, never by the language model. The model only chooses which tool to call
// and phrases the result; the rule-based fallback calls the same functions.
//
// Write tools never modify data. They validate the request against the current
// dataset and return a *proposal*; the change is applied only when an admin
// confirms it (see actions.js and POST /api/vera/actions/confirm).

const wqm = require('./wqm');

const YEARS = [2024, 2025, 2026];

const fail = (message, extra = {}) => ({ ok: false, error: message, ...extra });

const fmtValue = (raw) => (raw === null || raw === undefined ? null : (typeof raw === 'number' ? wqm.round2(raw) : raw));

/**
 * @param {object} ctx
 * @param {(year:number) => Promise<Array>} ctx.loadYear  stored sheets for a year
 * @param {number} ctx.defaultYear   year to use when the user names none
 * @param {number} ctx.horizon       admin forecast horizon (months)
 * @param {boolean} ctx.canWrite     admin/developer and CRUD enabled
 * @param {(proposal:object) => object} ctx.propose  registers a pending action
 */
const createToolset = (ctx) => {
  const yearOf = (year) => {
    const y = Number(year || ctx.defaultYear);
    return YEARS.includes(y) ? y : null;
  };

  const sheetFor = async (year, waterbody) => {
    const y = yearOf(year);
    if (!y) return { error: fail(`Year must be one of ${YEARS.join(', ')}.`) };
    const sheets = await ctx.loadYear(y);
    if (!sheets.length) return { error: fail(`No WQM ${y} data is stored.`) };
    if (!waterbody) return { year: y, sheets };
    const sheet = wqm.findSheet(sheets, waterbody);
    if (!sheet) {
      return { error: fail(`No waterbody matching "${waterbody}" in WQM ${y}.`, { available: sheets.map((s) => wqm.displayName(s.name)) }) };
    }
    return { year: y, sheets, sheet };
  };

  const stationFor = (sheet, station) => {
    const found = wqm.findStation(sheet, station);
    if (found) return { station: found };
    return { error: fail(`No station matching "${station}" in ${wqm.displayName(sheet.name)}.`, { stations: wqm.stationsOf(sheet).map((s) => `${s.stnNo}. ${s.stnId}`) }) };
  };

  const paramFor = (parameter) => {
    const param = wqm.resolveParam(parameter);
    return param ? { param } : { error: fail(`Unknown parameter "${parameter}".`, { parameters: wqm.PARAM_ORDER }) };
  };

  const tools = {
    list_waterbodies: {
      description: 'List the monitored waterbodies for a year with their class and station count.',
      parameters: { year: { type: 'integer', description: 'Monitoring year (2024, 2025 or 2026). Defaults to the published year.' } },
      run: async ({ year }) => {
        const r = await sheetFor(year);
        if (r.error) return r.error;
        return {
          ok: true,
          year: r.year,
          waterbodies: r.sheets.map((s) => ({ name: wqm.displayName(s.name), key: s.key, classInfo: s.classInfo || '', stations: wqm.stationsOf(s).length, schedule: s.periodLabels?.[0] === 'Q1' ? 'quarterly' : 'monthly' })),
        };
      },
    },

    get_station_readings: {
      description: 'All readings of a waterbody (optionally one station and/or one parameter), with annual averages and status against the water quality guideline used by the dashboards.',
      parameters: {
        year: { type: 'integer' },
        waterbody: { type: 'string', description: 'Waterbody name or key, e.g. "Meycauayan River".' },
        station: { type: 'string', description: 'Station number or name. Omit for every station.' },
        parameter: { type: 'string', description: 'Parameter, e.g. "DO", "BOD", "fecal coliform". Omit for all.' },
        period: { type: 'string', description: 'Only this month ("Aug") or quarter ("Q3"). Omit for every period.' },
      },
      required: ['waterbody'],
      run: async ({ year, waterbody, station, parameter, period }) => {
        const r = await sheetFor(year, waterbody);
        if (r.error) return r.error;
        let stations = wqm.stationsOf(r.sheet);
        if (station) {
          const s = stationFor(r.sheet, station);
          if (s.error) return s.error;
          stations = [s.station];
        }
        let params = wqm.availableParams(r.sheet);
        if (parameter) {
          const p = paramFor(parameter);
          if (p.error) return p.error;
          params = [p.param];
        }
        return {
          ok: true,
          year: r.year,
          waterbody: wqm.displayName(r.sheet.name),
          classInfo: r.sheet.classInfo || '',
          stations: stations.map((st) => ({
            stnNo: st.stnNo,
            stnId: st.stnId,
            address: st.address || '',
            readings: params.map((param) => {
              const onlyIndex = period ? wqm.resolvePeriodIndex(r.sheet, period) : null;
              const series = wqm.seriesFor(r.sheet, st, param).filter((pt) => onlyIndex === null || pt.index === onlyIndex);
              const numeric = series.filter((p) => p.value !== null).map((p) => p.value);
              const avg = numeric.length ? wqm.round2(numeric.reduce((a, b) => a + b, 0) / numeric.length) : null;
              return {
                parameter: param,
                standard: wqm.describeLimit(param),
                values: series.map((p) => ({ period: p.period, value: fmtValue(p.raw), status: wqm.getStatus(param, p.value) })),
                average: avg,
                averageStatus: wqm.getStatus(param, avg),
              };
            }).filter((reading) => reading.values.length),
          })),
        };
      },
    },

    latest_readings: {
      description: 'The most recent reading per station for one parameter, across one waterbody or every waterbody.',
      parameters: {
        year: { type: 'integer' },
        parameter: { type: 'string' },
        waterbody: { type: 'string', description: 'Omit to cover every waterbody.' },
      },
      required: ['parameter'],
      run: async ({ year, parameter, waterbody }) => {
        const p = paramFor(parameter);
        if (p.error) return p.error;
        const r = await sheetFor(year, waterbody);
        if (r.error) return r.error;
        const sheets = r.sheet ? [r.sheet] : r.sheets;
        const rows = [];
        sheets.forEach((sheet) => wqm.stationsOf(sheet).forEach((st) => {
          const latest = wqm.seriesFor(sheet, st, p.param).filter((pt) => pt.value !== null).at(-1);
          if (latest) {
            rows.push({ waterbody: wqm.displayName(sheet.name), station: `${st.stnNo}. ${st.stnId}`, period: latest.period, value: fmtValue(latest.raw), status: wqm.getStatus(p.param, latest.value) });
          }
        }));
        return { ok: true, year: r.year, parameter: p.param, standard: wqm.describeLimit(p.param), count: rows.length, rows: rows.slice(0, 60), truncated: rows.length > 60 };
      },
    },

    find_exceedances: {
      description: 'Readings that fail the water quality guideline, grouped by waterbody. Use for "which stations failed / exceeded / are critical".',
      parameters: {
        year: { type: 'integer' },
        parameter: { type: 'string', description: 'Omit to check every parameter with a guideline.' },
        waterbody: { type: 'string', description: 'Omit for every waterbody.' },
        period: { type: 'string', description: 'Month (e.g. "Sep") or quarter ("Q3"). Omit for all periods.' },
      },
      run: async ({ year, parameter, waterbody, period }) => {
        let params = Object.keys(wqm.PARAM_LIMITS);
        if (parameter) {
          const p = paramFor(parameter);
          if (p.error) return p.error;
          params = [p.param];
        }
        const r = await sheetFor(year, waterbody);
        if (r.error) return r.error;
        const sheets = r.sheet ? [r.sheet] : r.sheets;
        const rows = [];
        sheets.forEach((sheet) => {
          const onlyIndex = period ? wqm.resolvePeriodIndex(sheet, period) : null;
          wqm.stationsOf(sheet).forEach((st) => params.forEach((param) => {
            wqm.seriesFor(sheet, st, param).forEach((pt) => {
              if (onlyIndex !== null && pt.index !== onlyIndex) return;
              if (wqm.getStatus(param, pt.value) === 'exceeds standard') {
                rows.push({ waterbody: wqm.displayName(sheet.name), station: `${st.stnNo}. ${st.stnId}`, parameter: param, period: pt.period, value: fmtValue(pt.raw), standard: wqm.describeLimit(param) });
              }
            });
          }));
        });
        const byWaterbody = Object.entries(rows.reduce((acc, row) => ({ ...acc, [row.waterbody]: (acc[row.waterbody] || 0) + 1 }), {}))
          .sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ waterbody: name, exceedances: count }));
        return { ok: true, year: r.year, total: rows.length, byWaterbody, rows: rows.slice(0, 50), truncated: rows.length > 50 };
      },
    },

    summarize_parameter: {
      description: 'Minimum, maximum, average and the highest/lowest stations for one parameter, across one waterbody or all.',
      parameters: { year: { type: 'integer' }, parameter: { type: 'string' }, waterbody: { type: 'string' } },
      required: ['parameter'],
      run: async ({ year, parameter, waterbody }) => {
        const p = paramFor(parameter);
        if (p.error) return p.error;
        const r = await sheetFor(year, waterbody);
        if (r.error) return r.error;
        const sheets = r.sheet ? [r.sheet] : r.sheets;
        const points = [];
        sheets.forEach((sheet) => wqm.stationsOf(sheet).forEach((st) => wqm.seriesFor(sheet, st, p.param).forEach((pt) => {
          if (pt.value !== null) points.push({ waterbody: wqm.displayName(sheet.name), station: `${st.stnNo}. ${st.stnId}`, period: pt.period, value: pt.value });
        })));
        if (!points.length) return fail(`No ${p.param} readings found.`);
        const sorted = [...points].sort((a, b) => b.value - a.value);
        const avg = points.reduce((sum, pt) => sum + pt.value, 0) / points.length;
        const exceed = points.filter((pt) => wqm.getStatus(p.param, pt.value) === 'exceeds standard').length;
        return {
          ok: true, year: r.year, parameter: p.param, standard: wqm.describeLimit(p.param),
          readings: points.length, average: wqm.round2(avg), min: sorted.at(-1), max: sorted[0],
          highest: sorted.slice(0, 3), lowest: sorted.slice(-3).reverse(),
          exceedances: exceed, exceedanceRate: `${Math.round((exceed / points.length) * 100)}%`,
        };
      },
    },

    compare_years: {
      description: 'Annual average of a parameter for a waterbody (optionally one station) in each stored year — for multi-year trends.',
      parameters: { waterbody: { type: 'string' }, parameter: { type: 'string' }, station: { type: 'string' } },
      required: ['waterbody', 'parameter'],
      run: async ({ waterbody, parameter, station }) => {
        const p = paramFor(parameter);
        if (p.error) return p.error;
        const years = [];
        for (const y of YEARS) {
          const sheets = await ctx.loadYear(y);
          const sheet = wqm.findSheet(sheets, waterbody);
          if (!sheet) { years.push({ year: y, average: null, note: 'waterbody not monitored' }); continue; }
          let stations = wqm.stationsOf(sheet);
          if (station) {
            const st = wqm.findStation(sheet, station);
            stations = st ? [st] : [];
          }
          const values = stations.flatMap((st) => wqm.seriesFor(sheet, st, p.param).map((pt) => pt.value)).filter((v) => v !== null);
          years.push({ year: y, waterbody: wqm.displayName(sheet.name), readings: values.length, average: values.length ? wqm.round2(values.reduce((a, b) => a + b, 0) / values.length) : null });
        }
        return { ok: true, parameter: p.param, standard: wqm.describeLimit(p.param), years };
      },
    },

    forecast: {
      description: 'Forecast a parameter at a station for the next months using the same engine as the dashboard (Prophet-style additive by default, or OLS). The horizon defaults to the admin Forecast Horizon setting.',
      parameters: {
        year: { type: 'integer' },
        waterbody: { type: 'string' },
        station: { type: 'string' },
        parameter: { type: 'string' },
        engine: { type: 'string', enum: ['prophet', 'ols'] },
      },
      required: ['waterbody', 'station', 'parameter'],
      run: async ({ year, waterbody, station, parameter, engine }) => {
        const p = paramFor(parameter);
        if (p.error) return p.error;
        const r = await sheetFor(year, waterbody);
        if (r.error) return r.error;
        const s = stationFor(r.sheet, station);
        if (s.error) return s.error;
        const observed = wqm.seriesFor(r.sheet, s.station, p.param).filter((pt) => pt.value !== null);
        if (observed.length < 2) return fail(`Not enough ${p.param} readings at ${s.station.stnId} to forecast (need at least 2, found ${observed.length}).`);
        const chosen = wqm.FORECAST_ENGINES[engine] ? engine : 'prophet';
        const result = wqm.FORECAST_ENGINES[chosen].build(observed.map((pt) => ({ month: pt.period, actual: pt.value })), ctx.horizon);
        const quarterly = r.sheet.periodLabels?.[0] === 'Q1';
        const lastIndex = observed.at(-1).index;
        const labelFor = (i) => (quarterly ? `Q${((lastIndex + 1 + i) % 4) + 1}` : wqm.MONTHS_SHORT[(lastIndex + 1 + i) % 12]);
        return {
          ok: true,
          year: r.year,
          waterbody: wqm.displayName(r.sheet.name),
          station: `${s.station.stnNo}. ${s.station.stnId}`,
          parameter: p.param,
          standard: wqm.describeLimit(p.param),
          engine: wqm.FORECAST_ENGINES[chosen].label,
          horizon: ctx.horizon,
          observed: observed.map((pt) => ({ period: pt.period, value: wqm.round2(pt.value) })),
          forecast: result.points.map((pt, i) => {
            const value = wqm.round2(wqm.clampForecastValue(p.param, pt.forecast));
            return {
              period: labelFor(i),
              value,
              range: [wqm.round2(wqm.clampForecastValue(p.param, pt.lower)), wqm.round2(wqm.clampForecastValue(p.param, pt.upper))],
              confidence: `${pt.confidence}%`,
              status: wqm.getStatus(p.param, value),
            };
          }),
          trend: result.diagnostics.trend,
          rmse: wqm.round2(result.diagnostics.rmse),
        };
      },
    },
  };

  // ── Write proposals (admin/developer, CRUD enabled) ──────────────────────
  const writeTools = {
    propose_update_reading: {
      description: 'Propose setting (or clearing, with value null) one reading. Nothing changes until the user clicks Confirm.',
      parameters: {
        year: { type: 'integer' },
        waterbody: { type: 'string' },
        station: { type: 'string' },
        parameter: { type: 'string' },
        period: { type: 'string', description: 'Month ("Sep") or quarter ("Q3").' },
        value: { type: 'string', description: 'New value, e.g. "4.74" or "<0.1". Empty string clears the reading.' },
      },
      required: ['waterbody', 'station', 'parameter', 'period', 'value'],
      run: async ({ year, waterbody, station, parameter, period, value }) => {
        const r = await sheetFor(year, waterbody);
        if (r.error) return r.error;
        const s = stationFor(r.sheet, station);
        if (s.error) return s.error;
        const p = paramFor(parameter);
        if (p.error) return p.error;
        const index = wqm.resolvePeriodIndex(r.sheet, period);
        if (index < 0) return fail(`"${period}" is not a valid ${r.sheet.periodLabels?.[0] === 'Q1' ? 'quarter (Q1–Q4)' : 'month'} for ${wqm.displayName(r.sheet.name)}.`);
        const found = wqm.getParamData(s.station, p.param);
        const before = found?.data?.monthly?.[index] ?? null;
        const after = wqm.parseEditableValue(value);
        if (String(before ?? '') === String(after ?? '')) return fail(`That reading is already ${before ?? 'blank'}; nothing to change.`);
        return ctx.propose({
          type: 'update_reading', year: r.year, sheetKey: r.sheet.key, stnNo: s.station.stnNo,
          paramKey: found?.key || p.param, periodIndex: index, before, after,
          summary: `${wqm.displayName(r.sheet.name)} · ${s.station.stnNo}. ${s.station.stnId} · ${p.param} · ${wqm.periodLabel(r.sheet, index)} ${r.year}: ${before ?? '(blank)'} → ${after ?? '(blank)'}`,
        });
      },
    },

    propose_set_sampling_date: {
      description: 'Propose setting the date of sampling for a period, for one station or every station of a waterbody.',
      parameters: {
        year: { type: 'integer' },
        waterbody: { type: 'string' },
        period: { type: 'string' },
        date: { type: 'string', description: 'MM/DD/YYYY' },
        station: { type: 'string', description: 'Omit to apply to every station.' },
      },
      required: ['waterbody', 'period', 'date'],
      run: async ({ year, waterbody, period, date, station }) => {
        const r = await sheetFor(year, waterbody);
        if (r.error) return r.error;
        if (!/^\d{2}\/\d{2}\/\d{4}$/.test(String(date || ''))) return fail('Date must be MM/DD/YYYY.');
        const index = wqm.resolvePeriodIndex(r.sheet, period);
        if (index < 0) return fail(`"${period}" is not a valid period for ${wqm.displayName(r.sheet.name)}.`);
        let stnNo = null;
        if (station) {
          const s = stationFor(r.sheet, station);
          if (s.error) return s.error;
          stnNo = s.station.stnNo;
        }
        return ctx.propose({
          type: 'set_sampling_date', year: r.year, sheetKey: r.sheet.key, stnNo, periodIndex: index, after: date,
          summary: `${wqm.displayName(r.sheet.name)}${stnNo !== null ? ` · station ${stnNo}` : ' · all stations'} · date of sampling for ${wqm.periodLabel(r.sheet, index)} ${r.year} → ${date}`,
        });
      },
    },

    propose_add_station: {
      description: 'Propose adding a new station (with empty readings for the waterbody\'s parameters).',
      parameters: { year: { type: 'integer' }, waterbody: { type: 'string' }, name: { type: 'string' }, address: { type: 'string' } },
      required: ['waterbody', 'name'],
      run: async ({ year, waterbody, name, address }) => {
        const r = await sheetFor(year, waterbody);
        if (r.error) return r.error;
        const stnId = String(name || '').trim().slice(0, 120);
        if (!stnId) return fail('A station name is required.');
        if (wqm.stationsOf(r.sheet).some((s) => s.stnId.toLowerCase() === stnId.toLowerCase())) return fail(`${wqm.displayName(r.sheet.name)} already has a station named "${stnId}".`);
        const nos = wqm.stationsOf(r.sheet).map((s) => Number(s.stnNo)).filter(Number.isFinite);
        const stnNo = (nos.length ? Math.max(...nos) : 0) + 1;
        return ctx.propose({
          type: 'add_station', year: r.year, sheetKey: r.sheet.key, stnNo, stnId, address: String(address || '').trim().slice(0, 200),
          summary: `Add station ${stnNo}. ${stnId} to ${wqm.displayName(r.sheet.name)} (${r.year})`,
        });
      },
    },

    propose_update_station: {
      description: 'Propose renaming a station or changing its address.',
      parameters: { year: { type: 'integer' }, waterbody: { type: 'string' }, station: { type: 'string' }, name: { type: 'string' }, address: { type: 'string' } },
      required: ['waterbody', 'station'],
      run: async ({ year, waterbody, station, name, address }) => {
        const r = await sheetFor(year, waterbody);
        if (r.error) return r.error;
        const s = stationFor(r.sheet, station);
        if (s.error) return s.error;
        const changes = {};
        if (name && name.trim() !== s.station.stnId) changes.stnId = name.trim().slice(0, 120);
        if (address !== undefined && address.trim() !== (s.station.address || '')) changes.address = address.trim().slice(0, 200);
        if (!Object.keys(changes).length) return fail('Nothing to change.');
        return ctx.propose({
          type: 'update_station', year: r.year, sheetKey: r.sheet.key, stnNo: s.station.stnNo, before: { stnId: s.station.stnId, address: s.station.address || '' }, after: changes,
          summary: `${wqm.displayName(r.sheet.name)} · station ${s.station.stnNo}: ${Object.entries(changes).map(([k, v]) => `${k === 'stnId' ? 'name' : k} → "${v}"`).join(', ')} (${r.year})`,
        });
      },
    },

    propose_delete_station: {
      description: 'Propose deleting a station and all of its readings for that year.',
      parameters: { year: { type: 'integer' }, waterbody: { type: 'string' }, station: { type: 'string' } },
      required: ['waterbody', 'station'],
      run: async ({ year, waterbody, station }) => {
        const r = await sheetFor(year, waterbody);
        if (r.error) return r.error;
        const s = stationFor(r.sheet, station);
        if (s.error) return s.error;
        return ctx.propose({
          type: 'delete_station', year: r.year, sheetKey: r.sheet.key, stnNo: s.station.stnNo, before: { stnId: s.station.stnId },
          summary: `Delete station ${s.station.stnNo}. ${s.station.stnId} and all its readings from ${wqm.displayName(r.sheet.name)} (${r.year})`,
        });
      },
    },
  };

  return ctx.canWrite ? { ...tools, ...writeTools } : tools;
};

module.exports = { createToolset, YEARS };

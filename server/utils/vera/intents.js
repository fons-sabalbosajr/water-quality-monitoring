// Rule-based VERA: understands the common data questions without a language
// model, by pulling waterbody / station / parameter / period / year out of the
// message and calling the same tools the model would. Used when no model is
// configured and as the fallback when the model call fails.

const wqm = require('./wqm');

const YEAR_RE = /\b(2024|2025|2026)\b/;
const STATION_RE = /\b(?:station|stn\.?|stn\s*no\.?|stn\s*#)\s*#?\s*(\d+)\b/i;
const PERIOD_RE = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|q[1-4])\b/i;
const VALUE_RE = /\bto\s+(<\s*\d+(?:\.\d+)?|-?\d+(?:\.\d+)?|blank|empty|nothing|null)\b/i;

const fmtCell = (cell) => (typeof cell === 'number' ? cell.toLocaleString('en-US', { maximumFractionDigits: 2 }) : cell);

const table = (headers, rows) => {
  if (!rows.length) return '';
  const line = (cells) => `| ${cells.map((c) => String(fmtCell(c) ?? '—').replace(/\|/g, '/')).join(' | ')} |`;
  return [line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n');
};

/** Pull the entities VERA needs out of free text. */
const extractEntities = (message, sheets) => {
  const text = String(message || '');
  const lower = text.toLowerCase();
  const yearMatch = text.match(YEAR_RE);
  const stationMatch = text.match(STATION_RE);
  const periodMatch = text.match(PERIOD_RE);

  // Waterbody: the sheet whose distinctive name words all appear in the text.
  let waterbody = null;
  let best = 0;
  // Both the display name ("Beach Monitoring (Zambales Bay)") and the key
  // ("ZAMBALES BAY") are tried, so either way of saying it matches.
  sheets.forEach((sheet) => {
    [sheet.name, sheet.key].forEach((label) => {
      const words = String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
        .filter((w) => w.length > 2 && !['river', 'bay', 'coast', 'the', 'beach', 'resort', 'club', 'wqma', 'monitoring'].includes(w));
      if (!words.length) return;
      const hits = words.filter((w) => new RegExp(`\\b${w}\\b`).test(lower)).length;
      const score = hits / words.length + hits * 0.01;
      if (hits && hits === words.length && score > best) { best = score; waterbody = sheet; }
    });
  });

  // Parameter: scan words so "BOD" in "forecast BOD at …" resolves. The verb
  // "do" ("how do I…") is only dissolved oxygen when written "DO" or spelled out.
  const mentionsDo = /\bDO\b/.test(text) || /dissolved\s+oxygen|\boxygen\b/i.test(text);
  const accept = (p) => p && p !== wqm.OBSERVATION_PARAM && (p !== 'DO (mg/L)' || mentionsDo);
  let parameter = null;
  const tokens = lower.match(/[a-z0-9-]+(?:\s+[a-z]+)?/g) || [];
  for (const token of tokens) {
    const p = wqm.resolveParam(token);
    if (accept(p)) { parameter = p; break; }
  }
  if (!parameter) {
    const p = wqm.resolveParam(lower);
    if (accept(p)) parameter = p;
  }

  // "the second one", "third station" → station number.
  const ordinal = lower.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth)\s+(one|station|stn)\b/);
  const ordinalNo = ordinal ? ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'].indexOf(ordinal[1]) + 1 : null;

  return {
    year: yearMatch ? Number(yearMatch[1]) : undefined,
    waterbody: waterbody ? waterbody.name : undefined,
    station: stationMatch ? stationMatch[1] : (ordinalNo ? String(ordinalNo) : undefined),
    period: periodMatch ? periodMatch[1] : undefined,
    parameter: parameter || undefined,
  };
};

const detectIntent = (message, canWrite) => {
  const l = String(message || '').toLowerCase();
  if (canWrite && /\b(delete|remove)\b.*\bstation\b/.test(l)) return 'propose_delete_station';
  if (canWrite && /\b(set|change|update|correct|fix|edit|replace)\b/.test(l) && VALUE_RE.test(l)) return 'propose_update_reading';
  if (/\b(forecast|predict|projection|project|next\s+(month|quarter)s?|will\s+be|outlook)\b/.test(l)) return 'forecast';
  if (/\b(compare|comparison|over the years|year[- ]on[- ]year|across years|vs\.?|versus)\b/.test(l)) return 'compare_years';
  if (/\b(exceed\w*|fail\w*|violat\w*|non[- ]?complian\w*|critical|above (the )?(standard|guideline|limit)|below (the )?(standard|guideline|limit)|out of (standard|range))\b/.test(l)) return 'find_exceedances';
  if (/\b(highest|lowest|max(imum)?|min(imum)?|average|mean|summar\w*|worst|best|rank\w*|top)\b/.test(l)) return 'summarize_parameter';
  if (/\b(latest|current|recent|now|last reading)\b/.test(l)) return 'latest_readings';
  if (/\b(list|which|what|how many)\b.*\bwaterbod/.test(l)) return 'list_waterbodies';
  return null;
};

// ── Formatters ───────────────────────────────────────────────────────────────
const formatters = {
  list_waterbodies: (r) => `**WQM ${r.year} — ${r.waterbodies.length} waterbodies**\n\n${table(['Waterbody', 'Class', 'Stations', 'Schedule'], r.waterbodies.map((w) => [w.name, w.classInfo.replace(/\s*\(.*\)/, ''), w.stations, w.schedule]))}`,

  get_station_readings: (r) => {
    const blocks = r.stations.map((st) => {
      const rows = st.readings.map((rd) => [rd.parameter, rd.values.map((v) => `${v.period} ${v.value}`).join(', '), rd.average ?? '—', rd.averageStatus]);
      return `**${st.stnNo}. ${st.stnId}**${st.address ? ` — ${st.address}` : ''}\n\n${table(['Parameter', 'Readings', 'Average', 'Status'], rows)}`;
    });
    return `**${r.waterbody} — WQM ${r.year}**\n\n${blocks.join('\n\n')}`;
  },

  latest_readings: (r) => {
    const failing = r.rows.filter((row) => row.status === 'exceeds standard').length;
    return `**Latest ${r.parameter} — WQM ${r.year}** (guideline ${r.standard || 'n/a'})\n\n**Summary:** ${r.count} stations, ${failing} currently outside the guideline.\n\n${table(['Waterbody', 'Station', 'Period', 'Value', 'Status'], r.rows.map((row) => [row.waterbody, row.station, row.period, row.value, row.status]))}${r.truncated ? '\n\n(First 60 stations shown.)' : ''}`;
  },

  find_exceedances: (r) => {
    if (!r.total) return `No guideline exceedances found in WQM ${r.year} for that selection.`;
    const head = `**Guideline exceedances — WQM ${r.year}**\n\n**Summary:** ${r.total} failing readings across ${r.byWaterbody.length} waterbod${r.byWaterbody.length === 1 ? 'y' : 'ies'}.`;
    // Across several waterbodies the useful answer is the ranking; station
    // detail is one follow-up away ("…at Meycauayan River").
    if (r.byWaterbody.length > 1) {
      return `${head}\n\n${table(['Waterbody', 'Failing readings'], r.byWaterbody.slice(0, 12).map((w) => [w.waterbody, w.exceedances]))}${r.byWaterbody.length > 12 ? `\n\n(Top 12 of ${r.byWaterbody.length}.)` : ''}\n\nAsk about one waterbody for station-level detail.`;
    }
    return `${head}\n\n${table(['Station', 'Parameter', 'Period', 'Value', 'Guideline'], r.rows.slice(0, 25).map((row) => [row.station, row.parameter, row.period, row.value, row.standard]))}${r.total > 25 ? `\n\n(Showing 25 of ${r.total}.)` : ''}`;
  },

  summarize_parameter: (r) => `**${r.parameter} — WQM ${r.year}** (guideline ${r.standard || 'n/a'})\n\n**Summary:** ${r.readings} readings · average ${r.average} · ${r.exceedances} outside the guideline (${r.exceedanceRate}).\n\n**Highest**\n${table(['Waterbody', 'Station', 'Period', 'Value'], r.highest.map((p) => [p.waterbody, p.station, p.period, wqm.round2(p.value)]))}\n\n**Lowest**\n${table(['Waterbody', 'Station', 'Period', 'Value'], r.lowest.map((p) => [p.waterbody, p.station, p.period, wqm.round2(p.value)]))}`,

  compare_years: (r) => `**${r.parameter} annual average by year** (guideline ${r.standard || 'n/a'})\n\n${table(['Year', 'Waterbody', 'Readings', 'Average'], r.years.map((y) => [y.year, y.waterbody || '—', y.readings ?? 0, y.average ?? (y.note || '—')]))}`,

  forecast: (r) => `**${r.parameter} forecast — ${r.waterbody}, station ${r.station}**\n\n**Summary:** trend ${r.trend}, latest ${r.observed.at(-1).value} (${r.observed.at(-1).period} ${r.year}), ${r.engine}, ${r.horizon}-period horizon.\n\n${table(['Period', 'Forecast', 'Likely range', 'Confidence', 'vs guideline'], r.forecast.map((f) => [f.period, f.value, `${f.range[0]} – ${f.range[1]}`, f.confidence, f.status]))}\n\nGuideline: ${r.standard || 'n/a'}. Forecasts are screening estimates from ${r.observed.length} readings; use the range, not the single value.`,
};

const formatToolResult = (name, result) => {
  if (!result?.ok) {
    const extra = result?.available ? `\n\nAvailable: ${result.available.slice(0, 12).join(', ')}${result.available.length > 12 ? '…' : ''}`
      : result?.stations ? `\n\nStations: ${result.stations.join(', ')}`
        : result?.parameters ? `\n\nParameters: ${result.parameters.join(', ')}` : '';
    return `${result?.error || 'I could not complete that.'}${extra}`;
  }
  if (result.proposal) return `I prepared this change — review it and click **Confirm** to apply it:\n\n${result.proposal.summary}`;
  return (formatters[name] || ((r) => JSON.stringify(r)))(result);
};

const MISSING = {
  forecast: ['waterbody', 'station', 'parameter'],
  get_station_readings: ['waterbody'],
  latest_readings: ['parameter'],
  summarize_parameter: ['parameter'],
  compare_years: ['waterbody', 'parameter'],
  propose_update_reading: ['waterbody', 'station', 'parameter', 'period'],
  propose_delete_station: ['waterbody', 'station'],
};

/**
 * @returns {Promise<{ answer: string, tool?: string } | null>} null when no data intent matched
 */
const WRITE_REQUEST_RE = /\b(set|change|update|correct|fix|edit|replace|delete|remove|add)\b.*\b(reading|value|station|data|sampling|to\s+[<\d])/i;

const FOLLOW_UP_RE = /^(and|what about|how about|also|then|same|ok|okay)\b|\b(it|that|those|this one|that one|the same|there)\b/i;

const route = async ({ message, tools, sheetsForMatching, canWrite, history = [] }) => {
  if (!canWrite && WRITE_REQUEST_RE.test(message)) {
    return {
      answer: 'Changing monitoring data is limited to administrators and developers. You can review the values in Tabular Results, and ask an administrator to make the correction (they can do it here through VERA or in the tabular editor).',
      tool: null,
    };
  }
  const entities = extractEntities(message, sheetsForMatching);
  let intent = detectIntent(message, canWrite);

  // Follow-up ("and the second one for August?"): inherit what this message
  // leaves out from the user's earlier turns, newest first.
  const isFollowUp = FOLLOW_UP_RE.test(message) || (!entities.waterbody && (entities.station || entities.period));
  if (isFollowUp) {
    const earlier = history.filter((m) => m.role === 'user').map((m) => m.content).reverse();
    for (const previous of earlier) {
      const prior = extractEntities(previous, sheetsForMatching);
      ['waterbody', 'parameter', 'year'].forEach((key) => { if (!entities[key] && prior[key]) entities[key] = prior[key]; });
      if (!entities.station && prior.station && prior.waterbody === entities.waterbody) entities.station = prior.station;
      if (!intent) intent = detectIntent(previous, canWrite);
      if (entities.waterbody && entities.parameter) break;
    }
  }
  if (intent === 'latest_readings' && entities.period) intent = 'get_station_readings';
  if (!intent && entities.waterbody && (entities.station || entities.parameter)) intent = 'get_station_readings';
  if (!intent || !tools[intent]) return null;

  const args = { ...entities };
  if (intent === 'propose_update_reading') {
    const v = String(message).match(VALUE_RE)?.[1] || '';
    args.value = /^(blank|empty|nothing|null)$/i.test(v) ? '' : v.replace(/\s+/g, '');
  }
  const missing = (MISSING[intent] || []).filter((key) => !args[key]);
  if (missing.length) {
    return {
      answer: `To do that I need the ${missing.join(', ').replace(/, ([^,]*)$/, ' and $1')}. For example: "${{
        forecast: 'Forecast DO at Meycauayan River station 2',
        propose_update_reading: 'Set DO at Meycauayan River station 2 for Sep to 1.7',
        propose_delete_station: 'Delete Marilao River station 5',
        compare_years: 'Compare BOD at Bocaue River across years',
      }[intent] || 'DO at Meycauayan River station 2'}".`,
      tool: intent,
    };
  }
  const result = await tools[intent].run(args);
  return { answer: formatToolResult(intent, result), tool: intent, result };
};

module.exports = { route, extractEntities, detectIntent, formatToolResult, table };

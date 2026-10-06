const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { adminProtect } = require('../middleware/adminMiddleware');
const WqmDataset = require('../models/WqmDataset');
const AppSetting = require('../models/AppSetting');
const { parseWorkbook } = require('../utils/wqmWorkbook');
const { validateSheets } = require('../utils/validateSheets');
const { FORECAST_MONTHS_KEY, clampForecastMonths } = require('../utils/forecastSettings');

// Every year below is stored in MongoDB (wqmdatasets). 2026 used to live only
// in each browser's local storage, so admin edits never reached the public
// dashboard or other devices; it is now served and saved like the archives.
const IMPORTED_WQM_YEARS = [2024, 2025, 2026];
const WQM_PUBLISHED_YEARS = [2024, 2025, 2026];
const PUBLISHED_WQM_YEAR_KEY = 'visualizationYear';
const DEFAULT_PUBLISHED_YEAR = 2026;
// The live (currently encoded) year keeps raw worksheet names as keys — the
// front-end province map and saved station coordinates use them — and keeps
// parameters with no readings yet so they stay available for data entry.
const LIVE_WQM_YEAR = 2026;
const YEAR_LIST = IMPORTED_WQM_YEARS.join(', ');

const workbookOptionsFor = (year) => (
  year === LIVE_WQM_YEAR ? { preserveSheetNames: true, keepEmptyParams: true } : {}
);

const getGeminiKey = () => process.env.GEMINI_API_KEY
  || process.env.GEMINI_KEY
  || process.env.GOOGLE_GEMINI_API_KEY
  || process.env.VITE_GEMINI_API_KEY
  || '';

const getMapTilerKey = () => process.env.MAPTILER_API_KEY
  || process.env.MAPTILER_KEY
  || process.env.VITE_MAPTILER_API_KEY
  || process.env.VITE_MAPTILER_KEY
  || '';

const DEFAULT_FORECAST_MODEL = 'gemini-2.5-flash';
const getGeminiModel = () => process.env.GEMINI_MODEL || DEFAULT_FORECAST_MODEL;
const FORECAST_TIMEOUT_MS = Number(process.env.FORECAST_TIMEOUT_MS || 25000);

const extractJson = (text) => {
  const cleaned = String(text || '').replace(/```json|```/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
};

const parseYear = (value) => {
  const year = Number(value);
  return Number.isInteger(year) ? year : NaN;
};

const importWqmYear = async (year) => {
  const sourceFile = path.resolve(__dirname, '..', '..', 'front-end', 'docs', `wqm${year}.xlsx`);
  // The import path only exists in a source checkout. Say so explicitly instead
  // of letting read-excel-file throw an opaque ENOENT.
  if (!fs.existsSync(sourceFile)) {
    const error = new Error(`Source workbook for WQM ${year} is not available on this server.`);
    error.status = 404;
    throw error;
  }
  const sheets = await parseWorkbook(sourceFile, year, workbookOptionsFor(year));
  if (!sheets.length) throw new Error(`No WQM sheets parsed for ${year}.`);
  return WqmDataset.findOneAndUpdate(
    { year },
    { year, sheets, sourceFile, importedAt: new Date() },
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true },
  );
};

const readPublishedYear = async () => {
  const setting = await AppSetting.findOne({ key: PUBLISHED_WQM_YEAR_KEY }).lean();
  const year = Number(setting?.value ?? DEFAULT_PUBLISHED_YEAR);
  return WQM_PUBLISHED_YEARS.includes(year) ? year : DEFAULT_PUBLISHED_YEAR;
};

// @route   GET /api/water/public/visualization-year
// @desc    Published year for the unauthenticated public dashboard
// @access  Public
// The public dashboard previously called the protected /visualization-year
// endpoint, so every public page load fired a request that 401'd and silently
// fell back to a locally cached year.
router.get('/public/visualization-year', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'public, max-age=60');
    return res.json({ year: await readPublishedYear() });
  } catch (error) {
    return next(error);
  }
});

// @route   GET /api/water/public/forecast-months
// @desc    Admin-configured forecast horizon, read by every dashboard (public
//          and signed-in) so the setting applies on all devices.
// @access  Public
router.get('/public/forecast-months', async (req, res, next) => {
  try {
    const setting = await AppSetting.findOne({ key: FORECAST_MONTHS_KEY }).select('value').lean();
    res.set('Cache-Control', 'public, max-age=60');
    return res.json({ months: clampForecastMonths(setting?.value) });
  } catch (error) {
    return next(error);
  }
});

router.get('/visualization-year', protect, async (req, res, next) => {
  try {
    return res.json({ year: await readPublishedYear() });
  } catch (error) {
    return next(error);
  }
});

/**
 * Serve a stored year. A WQM year document is several MB, so it is fetched with
 * a conditional-request guard: the importedAt timestamp is read first (a tiny
 * projection) and turned into an ETag. When the client already has that
 * version, the multi-MB sheets array is never loaded from Mongo or serialized.
 */
const sendYearDataset = async (req, res, year) => {
  const meta = await WqmDataset.findOne({ year }).select('importedAt updatedAt').lean();

  let dataset = meta;
  if (!dataset) {
    const imported = await importWqmYear(year);
    dataset = { importedAt: imported.importedAt };
  } else {
    const etag = `W/"wqm-${year}-${new Date(dataset.importedAt || 0).getTime()}"`;
    res.set('ETag', etag);
    res.set('Cache-Control', 'private, no-cache');
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }
  }

  const full = await WqmDataset.findOne({ year }).select('sheets importedAt').lean();
  if (!full) {
    return res.status(404).json({ message: `WQM ${year} data is not available.` });
  }
  res.set('ETag', `W/"wqm-${year}-${new Date(full.importedAt || 0).getTime()}"`);
  return res.json({
    year,
    importedAt: full.importedAt,
    sheets: full.sheets || [],
  });
};

// @route   GET /api/water/public/wqm/:year/meta
// @desc    Version stamp of a stored year. Clients poll this (a few bytes) and
//          only download the multi-MB year when importedAt has changed, so
//          edits saved by an admin reach every browser without a hard reload.
// @access  Public
router.get('/public/wqm/:year/meta', async (req, res, next) => {
  const year = parseYear(req.params.year);
  if (!IMPORTED_WQM_YEARS.includes(year)) {
    return res.status(400).json({ message: `Only WQM years ${YEAR_LIST} are available.` });
  }
  try {
    const meta = await WqmDataset.findOne({ year }).select('importedAt').lean();
    res.set('Cache-Control', 'no-cache');
    if (!meta) return res.status(404).json({ message: `WQM ${year} is not stored yet.` });
    return res.json({ year, importedAt: meta.importedAt });
  } catch (error) {
    return next(error);
  }
});

// @route   GET /api/water/public/wqm/:year
// @access  Public — read-only archive for the public dashboard
router.get('/public/wqm/:year', async (req, res, next) => {
  const year = parseYear(req.params.year);
  if (!IMPORTED_WQM_YEARS.includes(year)) {
    return res.status(400).json({ message: `Only WQM years ${YEAR_LIST} are available.` });
  }
  try {
    return await sendYearDataset(req, res, year);
  } catch (error) {
    if (error.status === 404) return res.status(404).json({ message: error.message });
    return next(error);
  }
});

router.get('/wqm/:year', protect, async (req, res, next) => {
  const year = parseYear(req.params.year);
  if (!IMPORTED_WQM_YEARS.includes(year)) {
    return res.status(400).json({ message: `Only WQM years ${YEAR_LIST} are available from MongoDB.` });
  }

  try {
    return await sendYearDataset(req, res, year);
  } catch (error) {
    if (error.status === 404) return res.status(404).json({ message: error.message });
    return next(error);
  }
});

// Importing rewrites a whole year from the bundled workbook — restrict it to
// admins/developers. It was previously open to any authenticated user, so a
// read-only account could overwrite live data with the source file.
router.post('/wqm/:year/import', protect, adminProtect, async (req, res, next) => {
  const year = parseYear(req.params.year);
  if (!IMPORTED_WQM_YEARS.includes(year)) {
    return res.status(400).json({ message: `Only WQM years ${YEAR_LIST} can be imported by this endpoint.` });
  }

  try {
    const dataset = await importWqmYear(year);
    return res.json({
      message: `WQM ${year} imported to MongoDB.`,
      year,
      importedAt: dataset.importedAt,
      sheetCount: dataset.sheets.length,
    });
  } catch (error) {
    if (error.status === 404) return res.status(404).json({ message: error.message });
    return next(error);
  }
});

// @route   PUT /api/water/wqm/:year
// @desc    Officially save updated WQM sheets to MongoDB (admin/developer only)
// @access  Private — admin or developer
router.put('/wqm/:year', protect, adminProtect, async (req, res, next) => {
  const year = parseYear(req.params.year);
  if (!IMPORTED_WQM_YEARS.includes(year)) {
    return res.status(400).json({ message: `Only WQM years ${YEAR_LIST} can be updated via this endpoint.` });
  }

  const { sheets } = req.body || {};
  const validationError = validateSheets(sheets);
  if (validationError) {
    return res.status(400).json({ message: validationError });
  }

  try {
    const dataset = await WqmDataset.findOneAndUpdate(
      { year },
      { $set: { sheets, importedAt: new Date() }, $setOnInsert: { year } },
      { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true },
    ).select('importedAt').lean();

    return res.json({
      message: `WQM ${year} saved to MongoDB.`,
      year,
      importedAt: dataset.importedAt,
      sheetCount: sheets.length,
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/forecast/status', protect, (req, res) => {
  res.json({
    configured: Boolean(getGeminiKey()),
    model: getGeminiModel(),
    recommendedModel: DEFAULT_FORECAST_MODEL,
    localEngines: [
      { id: 'prophet', label: 'Prophet (additive)', description: 'Linear trend + Fourier seasonality + widening uncertainty interval. Runs in-browser, no API key required.' },
      { id: 'ols', label: 'Fast trend (OLS)', description: 'Ordinary least squares trend with RMSE uncertainty band. Fast in-browser screening.' },
    ],
  });
});

router.get('/maptiler-key', protect, (req, res) => {
  const key = getMapTilerKey();
  res.set('Cache-Control', 'private, max-age=300');
  res.json({ configured: Boolean(key), key });
});

router.post('/forecast', protect, async (req, res) => {
  const apiKey = getGeminiKey();
  const model = getGeminiModel();

  if (!apiKey) {
    return res.status(503).json({
      message: 'Google AI API key is not configured on the server.',
      configured: false,
    });
  }

  const {
    waterbody,
    param,
    stations = [],
    observed = [],
    localForecast = [],
    diagnostics = {},
    currentAsOf = '',
  } = req.body || {};

  if (!Array.isArray(observed) || !Array.isArray(stations) || !Array.isArray(localForecast)) {
    return res.status(400).json({ message: 'observed, stations, and localForecast must be arrays.' });
  }

  const prompt = [
    'You are forecasting water quality monitoring readings from the current encoded dataset.',
    'Return only valid JSON with this shape:',
    '{"forecast":[{"month":"F1","forecast":number,"lower":number,"upper":number,"confidence":number,"method":"short method label"},{"month":"F2","forecast":number,"lower":number,"upper":number,"confidence":number,"method":"short method label"},{"month":"F3","forecast":number,"lower":number,"upper":number,"confidence":number,"method":"short method label"}],"analysis":"one concise technical sentence mentioning trend, RMSE/confidence, and latest encoded data"}',
    'Use the local OLS + RMSE forecast as the baseline unless current station readings show a defensible different direction.',
    'Keep values realistic for the parameter and avoid unsupported abrupt changes.',
    `Waterbody: ${waterbody || 'Unknown'}`,
    `Parameter: ${param || 'Unknown'}`,
    `Current data as of: ${currentAsOf || 'latest available encoded data'}`,
    `Observed monthly averages: ${JSON.stringify(observed)}`,
    `Station readings: ${JSON.stringify(stations)}`,
    `Local technical baseline forecast: ${JSON.stringify(localForecast)}`,
    `Local diagnostics: ${JSON.stringify(diagnostics)}`,
  ].join('\n');

  // Without a timeout an unresponsive upstream held the Express handler (and a
  // Mongo-pool-adjacent socket) open indefinitely.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), FORECAST_TIMEOUT_MS);

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: abort.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      }),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return res.status(response.status === 429 ? 429 : 502).json({
        // Never echo the upstream message verbatim — it can contain the key.
        message: response.status === 429
          ? 'AI forecast rate limit reached. Try again shortly.'
          : 'AI forecast request failed.',
        configured: true,
        model,
      });
    }

    const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text).join('\n') || '';
    const parsed = extractJson(text);
    const forecast = Array.isArray(parsed?.forecast)
      ? parsed.forecast
        .map((point, index) => ({
          month: point.month || `F${index + 1}`,
          forecast: Number(point.forecast),
          lower: Number(point.lower),
          upper: Number(point.upper),
          confidence: Number(point.confidence),
          method: point.method || 'AI adjusted OLS',
        }))
        .filter((point) => Number.isFinite(point.forecast))
        .map((point) => ({
          ...point,
          lower: Number.isFinite(point.lower) ? point.lower : undefined,
          upper: Number.isFinite(point.upper) ? point.upper : undefined,
          confidence: Number.isFinite(point.confidence) ? point.confidence : undefined,
        }))
        .slice(0, 3)
      : [];

    if (!forecast.length) {
      return res.status(502).json({
        message: 'AI model returned an unreadable forecast.',
        configured: true,
        model,
      });
    }

    return res.json({
      configured: true,
      model,
      analysis: parsed?.analysis || 'AI forecast generated from current readings.',
      forecast,
    });
  } catch (error) {
    const timedOut = error.name === 'AbortError';
    return res.status(timedOut ? 504 : 502).json({
      message: timedOut
        ? 'AI forecast timed out. The local forecast engines are still available.'
        : 'Unable to reach AI forecast service.',
      configured: true,
      model,
    });
  } finally {
    clearTimeout(timer);
  }
});

module.exports = router;

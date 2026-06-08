const express = require('express');
const path = require('path');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const WqmDataset = require('../models/WqmDataset');
const AppSetting = require('../models/AppSetting');
const { parseWorkbook } = require('../utils/wqmWorkbook');

const IMPORTED_WQM_YEARS = [2024, 2025];
const WQM_PUBLISHED_YEARS = [2024, 2025, 2026];
const PUBLISHED_WQM_YEAR_KEY = 'visualizationYear';

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

// Mock water quality data — replace with real MongoDB collection later
const mockReadings = [
  { id: 1, location: 'Station A', ph: 7.2, turbidity: 1.5, temperature: 26.4, dissolved_oxygen: 8.1, date: '2026-04-22T08:00:00Z', status: 'normal' },
  { id: 2, location: 'Station B', ph: 6.8, turbidity: 3.2, temperature: 28.0, dissolved_oxygen: 6.9, date: '2026-04-22T08:00:00Z', status: 'warning' },
  { id: 3, location: 'Station C', ph: 7.5, turbidity: 0.8, temperature: 25.1, dissolved_oxygen: 9.0, date: '2026-04-22T08:00:00Z', status: 'normal' },
  { id: 4, location: 'Station D', ph: 5.2, turbidity: 8.9, temperature: 30.5, dissolved_oxygen: 4.2, date: '2026-04-22T08:00:00Z', status: 'critical' },
];

const importWqmYear = async (year) => {
  const sourceFile = path.resolve(__dirname, '..', '..', 'front-end', 'docs', `wqm${year}.xlsx`);
  const sheets = await parseWorkbook(sourceFile, year);
  if (!sheets.length) throw new Error(`No WQM sheets parsed for ${year}.`);
  return WqmDataset.findOneAndUpdate(
    { year },
    { year, sheets, sourceFile, importedAt: new Date() },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
};

// @route   GET /api/water/readings
// @desc    Get all water quality readings
// @access  Private
router.get('/readings', protect, (req, res) => {
  res.json(mockReadings);
});

// @route   GET /api/water/summary
// @desc    Get summary statistics
// @access  Private
router.get('/summary', protect, (req, res) => {
  const total = mockReadings.length;
  const normal = mockReadings.filter((r) => r.status === 'normal').length;
  const warning = mockReadings.filter((r) => r.status === 'warning').length;
  const critical = mockReadings.filter((r) => r.status === 'critical').length;

  res.json({ total, normal, warning, critical });
});

router.get('/visualization-year', protect, async (req, res) => {
  try {
    const setting = await AppSetting.findOne({ key: PUBLISHED_WQM_YEAR_KEY });
    const year = Number(setting?.value || 2026);
    return res.json({ year: WQM_PUBLISHED_YEARS.includes(year) ? year : 2026 });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Unable to load published WQM year.' });
  }
});

router.get('/wqm/:year', protect, async (req, res) => {
  const year = Number(req.params.year);
  if (!IMPORTED_WQM_YEARS.includes(year)) {
    return res.status(400).json({ message: 'Only imported WQM years 2024 and 2025 are available from MongoDB.' });
  }

  try {
    let dataset = await WqmDataset.findOne({ year });
    if (!dataset) dataset = await importWqmYear(year);
    return res.json({
      year,
      importedAt: dataset.importedAt,
      sheets: dataset.sheets,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || `Unable to load WQM ${year} data.` });
  }
});

router.post('/wqm/:year/import', protect, async (req, res) => {
  const year = Number(req.params.year);
  if (!IMPORTED_WQM_YEARS.includes(year)) {
    return res.status(400).json({ message: 'Only WQM years 2024 and 2025 can be imported by this endpoint.' });
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
    return res.status(500).json({ message: error.message || `Unable to import WQM ${year}.` });
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
  res.json({
    configured: Boolean(getMapTilerKey()),
    key: getMapTilerKey(),
  });
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

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({
        message: data?.error?.message || 'AI forecast request failed.',
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
    return res.status(502).json({
      message: error.message || 'Unable to reach AI forecast service.',
      configured: true,
      model,
    });
  }
});

module.exports = router;

// VERA — Virtual Environmental Response Assistant API.
//
//   GET   /api/vera/status            any signed-in user — mode, greeting, starters
//   POST  /api/vera/chat              any signed-in user — ask VERA
//   POST  /api/vera/actions/confirm   admin/developer — apply a VERA proposal
//   GET   /api/vera/settings          developer — read VERA settings
//   PATCH /api/vera/settings          developer — change VERA settings
//   POST  /api/vera/settings/test     developer — check the model connection
//
// Security posture (from the ESWMP VERA): authenticated only; input sanitised and
// length-capped; secrets never reach the model or the client; per-user daily and
// burst limits; model calls time out; upstream errors are sanitised. Data changes
// are confirm-before-write with signed single-use tokens (utils/vera/actions.js).

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { adminProtect } = require('../middleware/adminMiddleware');
const WqmDataset = require('../models/WqmDataset');
const AppSetting = require('../models/AppSetting');
const { validateSheets } = require('../utils/validateSheets');
const { FORECAST_MONTHS_KEY, clampForecastMonths } = require('../utils/forecastSettings');
const vera = require('../utils/vera/assistant');
const kb = require('../utils/vera/knowledge');
const gemini = require('../utils/vera/gemini');
const { verifyActionToken, markUsed, applyAction } = require('../utils/vera/actions');
const { YEARS } = require('../utils/vera/tools');

const SETTINGS_KEY = 'veraSettings';
const PUBLISHED_YEAR_KEY = 'visualizationYear';
const DEFAULT_SETTINGS = {
  enabled: true,
  provider: 'gemini',
  model: process.env.VERA_MODEL || 'gemini-3.5-flash',
  temperature: 0.2,
  maxOutputTokens: 1500,
  allowCrud: true,
  dailyLimitPerUser: 200,
  requestTimeoutMs: 30000,
};
const PROVIDERS = ['gemini', 'none'];
const MODEL_SUGGESTIONS = ['gemini-3.5-flash', 'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-2.5-pro'];

const loadSettings = async () => {
  const doc = await AppSetting.findOne({ key: SETTINGS_KEY }).lean();
  return { ...DEFAULT_SETTINGS, ...(doc?.value || {}), updatedAt: doc?.updatedAt || null };
};

const requireDeveloper = (req, res, next) => {
  if (req.user?.role !== 'developer') return res.status(403).json({ message: 'VERA settings are restricted to developers.' });
  return next();
};

// ── Per-user limits (in-process, like the auth limiter) ──────────────────────
const usage = new Map(); // userId -> { day, count, burst: number[] }
const BURST_WINDOW_MS = 60 * 1000;
const BURST_MAX = 12;

const checkLimit = (userId, dailyLimit) => {
  const now = Date.now();
  const day = new Date().toDateString();
  const entry = usage.get(userId) || { day, count: 0, burst: [] };
  if (entry.day !== day) Object.assign(entry, { day, count: 0, burst: [] });
  entry.burst = entry.burst.filter((t) => now - t < BURST_WINDOW_MS);
  if (entry.count >= dailyLimit) return 'You have reached the daily VERA limit. It resets tomorrow.';
  if (entry.burst.length >= BURST_MAX) return 'You are sending messages too quickly. Wait a moment and try again.';
  entry.count += 1;
  entry.burst.push(now);
  usage.set(userId, entry);
  return null;
};

const readPublishedYear = async () => {
  const setting = await AppSetting.findOne({ key: PUBLISHED_YEAR_KEY }).lean();
  const year = Number(setting?.value ?? 2026);
  return YEARS.includes(year) ? year : 2026;
};

const readHorizon = async () => clampForecastMonths((await AppSetting.findOne({ key: FORECAST_MONTHS_KEY }).lean())?.value);

// One request may consult several years (compare_years); load each once.
const yearLoader = () => {
  const cache = new Map();
  return (year) => {
    if (!cache.has(year)) {
      cache.set(year, WqmDataset.findOne({ year }).select('sheets').lean().then((doc) => doc?.sheets || []));
    }
    return cache.get(year);
  };
};

const greetingRole = (role) => (role === 'admin' || role === 'developer' ? 'admin' : 'user');

router.use(protect);

router.get('/status', async (req, res) => {
  const settings = await loadSettings().catch(() => DEFAULT_SETTINGS);
  const operational = settings.enabled && settings.provider === 'gemini' && gemini.isConfigured();
  res.json({
    enabled: settings.enabled !== false,
    mode: operational ? 'model' : 'fallback',
    name: kb.ASSISTANT_NAME,
    fullName: kb.ASSISTANT_FULL_NAME,
    greeting: kb.GREETING[greetingRole(req.user.role)],
    starterQuestions: kb.STARTERS[greetingRole(req.user.role)],
    canWrite: greetingRole(req.user.role) === 'admin' && settings.allowCrud !== false,
  });
});

router.post('/chat', async (req, res, next) => {
  try {
    const settings = await loadSettings();
    if (settings.enabled === false) return res.status(503).json({ ok: false, message: 'VERA is turned off by the developer.' });
    const limited = checkLimit(String(req.user._id), Number(settings.dailyLimitPerUser) || DEFAULT_SETTINGS.dailyLimitPerUser);
    if (limited) return res.status(429).json({ ok: false, message: limited });

    const message = String(req.body?.message || '');
    if (!message.trim()) return res.status(400).json({ ok: false, message: 'Type a question for VERA.' });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(settings.requestTimeoutMs) || 30000);
    req.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      const [defaultYear, horizon] = await Promise.all([readPublishedYear(), readHorizon()]);
      const result = await vera.answer({
        message,
        history: req.body?.history,
        page: kb.PAGE_LABELS[String(req.body?.page || '').split(':')[0]] || '',
        role: req.user.role,
        userId: req.user._id,
        settings,
        loadYear: yearLoader(),
        defaultYear,
        horizon,
        signal: controller.signal,
      });
      return res.json({ ok: true, answer: result.answer, source: result.source, actions: result.actions, notice: result.notice });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    if (error.name === 'AbortError') return res.status(504).json({ ok: false, message: 'VERA took too long to answer. Try a narrower question.' });
    return next(error);
  }
});

router.post('/actions/confirm', adminProtect, async (req, res, next) => {
  try {
    const settings = await loadSettings();
    if (settings.allowCrud === false) return res.status(403).json({ message: 'Data changes through VERA are turned off.' });

    let payload;
    try {
      payload = verifyActionToken(req.body?.token, req.user._id);
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }
    const { action } = payload;
    const doc = await WqmDataset.findOne({ year: action.year }).select('sheets importedAt').lean();
    if (!doc) return res.status(404).json({ message: `WQM ${action.year} is not stored.` });

    let sheets;
    try {
      sheets = applyAction(doc.sheets, action);
    } catch (error) {
      return res.status(error.status || 400).json({ message: error.message });
    }
    const invalid = validateSheets(sheets);
    if (invalid) return res.status(400).json({ message: invalid });

    // Guard against a save that landed between our read and this write.
    const saved = await WqmDataset.findOneAndUpdate(
      { year: action.year, importedAt: doc.importedAt },
      { $set: { sheets, importedAt: new Date() } },
      { returnDocument: 'after' },
    ).select('importedAt').lean();
    if (!saved) return res.status(409).json({ message: 'The data changed while applying this. Ask VERA again.' });

    markUsed(payload.jti, payload.exp);
    return res.json({ ok: true, year: action.year, type: action.type, summary: action.summary, importedAt: saved.importedAt });
  } catch (error) {
    return next(error);
  }
});

// ── Developer settings ───────────────────────────────────────────────────────
router.get('/settings', requireDeveloper, async (req, res, next) => {
  try {
    const settings = await loadSettings();
    res.json({
      settings,
      providers: PROVIDERS,
      modelSuggestions: MODEL_SUGGESTIONS,
      // Presence only — the key itself never leaves the server.
      keyConfigured: gemini.isConfigured(),
      keySource: gemini.isConfigured() ? 'GEMINI_API_KEY (server environment)' : null,
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/settings', requireDeveloper, async (req, res, next) => {
  const body = req.body || {};
  const next_ = {};
  if (body.enabled !== undefined) next_.enabled = Boolean(body.enabled);
  if (body.allowCrud !== undefined) next_.allowCrud = Boolean(body.allowCrud);
  if (body.provider !== undefined) {
    if (!PROVIDERS.includes(body.provider)) return res.status(400).json({ message: `Provider must be one of ${PROVIDERS.join(', ')}.` });
    next_.provider = body.provider;
  }
  if (body.model !== undefined) {
    const model = String(body.model).trim();
    if (!/^[a-z0-9][a-z0-9.\-]{2,60}$/i.test(model)) return res.status(400).json({ message: 'Model id looks invalid.' });
    next_.model = model;
  }
  const numeric = [['temperature', 0, 1], ['maxOutputTokens', 256, 8192], ['dailyLimitPerUser', 1, 5000], ['requestTimeoutMs', 5000, 120000]];
  for (const [key, min, max] of numeric) {
    if (body[key] === undefined) continue;
    const value = Number(body[key]);
    if (!Number.isFinite(value) || value < min || value > max) return res.status(400).json({ message: `${key} must be between ${min} and ${max}.` });
    next_[key] = value;
  }
  try {
    const current = await loadSettings();
    const { updatedAt, ...stored } = current;
    const doc = await AppSetting.findOneAndUpdate(
      { key: SETTINGS_KEY },
      { key: SETTINGS_KEY, value: { ...stored, ...next_ }, updatedBy: req.user._id },
      { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true },
    ).lean();
    return res.json({ settings: { ...DEFAULT_SETTINGS, ...doc.value, updatedAt: doc.updatedAt } });
  } catch (error) {
    return next(error);
  }
});

router.get('/settings/models', requireDeveloper, async (req, res) => {
  if (!gemini.isConfigured()) return res.json({ models: MODEL_SUGGESTIONS, live: false });
  try {
    return res.json({ models: await gemini.listModels(), live: true });
  } catch (error) {
    return res.json({ models: MODEL_SUGGESTIONS, live: false, message: error.message });
  }
});

router.post('/settings/test', requireDeveloper, async (req, res) => {
  const settings = await loadSettings();
  if (!gemini.isConfigured()) return res.status(400).json({ ok: false, message: 'GEMINI_API_KEY is not set on the server.' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  const started = Date.now();
  try {
    const text = await gemini.testConnection({ model: req.body?.model || settings.model, signal: controller.signal });
    return res.json({ ok: true, model: req.body?.model || settings.model, reply: text.slice(0, 40), latencyMs: Date.now() - started });
  } catch (error) {
    return res.status(502).json({ ok: false, message: error.name === 'AbortError' ? 'The model did not answer within 15 seconds.' : error.message });
  } finally {
    clearTimeout(timer);
  }
});

module.exports = router;

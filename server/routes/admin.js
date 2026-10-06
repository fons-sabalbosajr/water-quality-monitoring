const express = require('express');
const router = express.Router();
const os = require('os');
const mongoose = require('mongoose');
const User = require('../models/User');
const AppSetting = require('../models/AppSetting');
const { protect, invalidateUser } = require('../middleware/authMiddleware');
const { adminProtect } = require('../middleware/adminMiddleware');

const { FORECAST_MONTHS_KEY, MAX_FORECAST_MONTHS, clampForecastMonths } = require('../utils/forecastSettings');

const PUBLISHED_WQM_YEAR_KEY = 'visualizationYear';
const WQM_PUBLISHED_YEARS = [2024, 2025, 2026];
const ROLES = ['admin', 'developer', 'user'];
const STATUSES = ['pending', 'approved', 'rejected'];
const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

// All routes require auth + admin/developer
router.use(protect, adminProtect);

// Reject malformed ids before they reach Mongo, so a bad path segment returns
// 400 instead of surfacing a CastError as a 500.
const withValidId = (handler) => async (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: 'Invalid user id.' });
  }
  return handler(req, res, next);
};

// @route GET /api/admin/users
router.get('/users', async (req, res, next) => {
  try {
    const { status } = req.query;
    if (status && !STATUSES.includes(status)) {
      return res.status(400).json({ message: 'Status filter must be pending, approved, or rejected.' });
    }
    const users = await User.find(status ? { status } : {})
      .select('-password -resetPasswordToken -resetPasswordExpires')
      .sort({ createdAt: -1 })
      .limit(2000)
      .lean();
    return res.json(users);
  } catch (err) {
    return next(err);
  }
});

// @route PATCH /api/admin/users/:id/role
router.patch('/users/:id/role', withValidId(async (req, res, next) => {
  const { role } = req.body || {};
  if (!ROLES.includes(role)) {
    return res.status(400).json({ message: 'Role must be admin, developer, or user' });
  }
  // Without this an admin can demote themselves and immediately lose access to
  // the very screen they are on.
  if (req.params.id === req.user._id.toString() && role === 'user') {
    return res.status(400).json({ message: 'Cannot remove your own administrator role.' });
  }
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { returnDocument: 'after', runValidators: true },
    ).select('-password -resetPasswordToken -resetPasswordExpires').lean();
    if (!user) return res.status(404).json({ message: 'User not found' });
    invalidateUser(req.params.id);
    return res.json(user);
  } catch (err) {
    return next(err);
  }
}));

// @route PATCH /api/admin/users/:id/status
router.patch('/users/:id/status', withValidId(async (req, res, next) => {
  const { status } = req.body || {};
  if (!STATUSES.includes(status)) {
    return res.status(400).json({ message: 'Status must be pending, approved, or rejected' });
  }
  if (req.params.id === req.user._id.toString() && status !== 'approved') {
    return res.status(400).json({ message: 'Cannot suspend your own administrator account.' });
  }
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { status },
      { returnDocument: 'after', runValidators: true },
    ).select('-password -resetPasswordToken -resetPasswordExpires').lean();
    if (!user) return res.status(404).json({ message: 'User not found' });
    // Drop the auth cache entry so a suspension takes effect on the next request
    // rather than after the 15s TTL.
    invalidateUser(req.params.id);
    return res.json(user);
  } catch (err) {
    return next(err);
  }
}));

// @route PATCH /api/admin/users/:id
router.patch('/users/:id', withValidId(async (req, res, next) => {
  const { name, email, role, status } = req.body || {};
  const updates = {};

  if (name !== undefined) {
    const trimmed = String(name).trim();
    if (!trimmed) return res.status(400).json({ message: 'Name is required.' });
    if (trimmed.length > 120) return res.status(400).json({ message: 'Name is too long (max 120 characters).' });
    updates.name = trimmed;
  }
  if (email !== undefined) {
    const trimmed = String(email).trim().toLowerCase();
    if (!trimmed) return res.status(400).json({ message: 'Email is required.' });
    // The schema has a match validator, but findByIdAndUpdate only runs it when
    // runValidators is set — validate here too so the message is explicit.
    if (!EMAIL_PATTERN.test(trimmed)) return res.status(400).json({ message: 'Enter a valid email address.' });
    updates.email = trimmed;
  }
  if (role !== undefined) {
    if (!ROLES.includes(role)) {
      return res.status(400).json({ message: 'Role must be admin, developer, or user' });
    }
    if (req.params.id === req.user._id.toString() && role === 'user') {
      return res.status(400).json({ message: 'Cannot remove your own administrator role.' });
    }
    updates.role = role;
  }
  if (status !== undefined) {
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ message: 'Status must be pending, approved, or rejected' });
    }
    if (req.params.id === req.user._id.toString() && status !== 'approved') {
      return res.status(400).json({ message: 'Cannot suspend your own administrator account.' });
    }
    updates.status = status;
  }

  if (!Object.keys(updates).length) {
    return res.status(400).json({ message: 'No changes were supplied.' });
  }

  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      updates,
      { returnDocument: 'after', runValidators: true },
    ).select('-password -resetPasswordToken -resetPasswordExpires').lean();
    if (!user) return res.status(404).json({ message: 'User not found' });
    invalidateUser(req.params.id);
    return res.json(user);
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ message: 'That email address is already registered.' });
    }
    return next(err);
  }
}));

// @route DELETE /api/admin/users/:id
router.delete('/users/:id', withValidId(async (req, res, next) => {
  if (req.params.id === req.user._id.toString()) {
    return res.status(400).json({ message: 'Cannot delete your own account.' });
  }
  try {
    // Refuse to delete the last remaining administrator — otherwise the system
    // can be locked out of its own account management screen.
    const target = await User.findById(req.params.id).select('role').lean();
    if (!target) return res.status(404).json({ message: 'User not found' });
    if (target.role === 'admin') {
      const adminCount = await User.countDocuments({ role: 'admin' });
      if (adminCount <= 1) {
        return res.status(400).json({ message: 'Cannot delete the last administrator account.' });
      }
    }

    await User.findByIdAndDelete(req.params.id);
    invalidateUser(req.params.id);
    return res.json({ message: 'User deleted.', _id: req.params.id });
  } catch (err) {
    return next(err);
  }
}));

// @route GET /api/admin/settings/visualization-year
router.get('/settings/visualization-year', async (req, res, next) => {
  try {
    const setting = await AppSetting.findOne({ key: PUBLISHED_WQM_YEAR_KEY }).lean();
    const year = Number(setting?.value ?? 2026);
    return res.json({
      year: WQM_PUBLISHED_YEARS.includes(year) ? year : 2026,
      updatedAt: setting?.updatedAt || null,
      updatedBy: setting?.updatedBy || null,
    });
  } catch (err) {
    return next(err);
  }
});

// @route PATCH /api/admin/settings/visualization-year
router.patch('/settings/visualization-year', async (req, res, next) => {
  const year = Number(req.body?.year);
  if (!WQM_PUBLISHED_YEARS.includes(year)) {
    return res.status(400).json({ message: 'Published WQM year must be 2024, 2025, or 2026.' });
  }

  try {
    const setting = await AppSetting.findOneAndUpdate(
      { key: PUBLISHED_WQM_YEAR_KEY },
      { key: PUBLISHED_WQM_YEAR_KEY, value: year, updatedBy: req.user._id },
      { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true },
    ).lean();
    return res.json({
      year: Number(setting.value),
      updatedAt: setting.updatedAt,
      updatedBy: setting.updatedBy,
    });
  } catch (err) {
    return next(err);
  }
});

// @route GET|PATCH /api/admin/settings/forecast-months
// The forecast horizon used to live only in the admin's browser storage, so the
// public dashboard (and admins on other devices) always forecast 3 months.
router.get('/settings/forecast-months', async (req, res, next) => {
  try {
    const setting = await AppSetting.findOne({ key: FORECAST_MONTHS_KEY }).lean();
    return res.json({
      months: clampForecastMonths(setting?.value),
      updatedAt: setting?.updatedAt || null,
      updatedBy: setting?.updatedBy || null,
    });
  } catch (err) {
    return next(err);
  }
});

router.patch('/settings/forecast-months', async (req, res, next) => {
  const months = Number(req.body?.months);
  if (!Number.isInteger(months) || months < 1 || months > MAX_FORECAST_MONTHS) {
    return res.status(400).json({ message: `Forecast horizon must be 1–${MAX_FORECAST_MONTHS} months.` });
  }

  try {
    const setting = await AppSetting.findOneAndUpdate(
      { key: FORECAST_MONTHS_KEY },
      { key: FORECAST_MONTHS_KEY, value: months, updatedBy: req.user._id },
      { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true },
    ).lean();
    return res.json({ months: Number(setting.value), updatedAt: setting.updatedAt, updatedBy: setting.updatedBy });
  } catch (err) {
    return next(err);
  }
});

// @route GET /api/admin/system
router.get('/system', (req, res) => {
  const dbState = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const memory = process.memoryUsage();
  res.json({
    nodeVersion: process.version,
    platform: os.platform(),
    uptime: Math.floor(process.uptime()),
    dbStatus: dbState[mongoose.connection.readyState] || 'unknown',
    dbName: mongoose.connection.name || '',
    memoryMB: Math.round(memory.heapUsed / 1024 / 1024),
    rssMB: Math.round(memory.rss / 1024 / 1024),
    hostname: os.hostname(),
    env: process.env.NODE_ENV || 'development',
  });
});

module.exports = router;

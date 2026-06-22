const express = require('express');
const router = express.Router();
const os = require('os');
const mongoose = require('mongoose');
const User = require('../models/User');
const AppSetting = require('../models/AppSetting');
const { protect } = require('../middleware/authMiddleware');
const { adminProtect } = require('../middleware/adminMiddleware');

const PUBLISHED_WQM_YEAR_KEY = 'visualizationYear';
const WQM_PUBLISHED_YEARS = [2024, 2025, 2026];

// All routes require auth + admin/developer
router.use(protect, adminProtect);

// @route GET /api/admin/users
router.get('/users', async (req, res) => {
  try {
    const filter = req.query.status ? { status: req.query.status } : {};
    const users = await User.find(filter).select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @route PATCH /api/admin/users/:id/role
router.patch('/users/:id/role', async (req, res) => {
  const { role } = req.body;
  if (!['admin', 'developer', 'user'].includes(role)) {
    return res.status(400).json({ message: 'Role must be admin, developer, or user' });
  }
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { returnDocument: 'after', select: '-password' }
    );
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @route PATCH /api/admin/users/:id/status
router.patch('/users/:id/status', async (req, res) => {
  const { status } = req.body;
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json({ message: 'Status must be pending, approved, or rejected' });
  }
  if (req.params.id === req.user._id.toString() && status !== 'approved') {
    return res.status(400).json({ message: 'Cannot suspend your own administrator account.' });
  }
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { status },
      { returnDocument: 'after', select: '-password' }
    );
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @route PATCH /api/admin/users/:id
router.patch('/users/:id', async (req, res) => {
  const { name, email, role, status } = req.body;
  const updates = {};

  if (name !== undefined) updates.name = String(name).trim();
  if (email !== undefined) updates.email = String(email).trim().toLowerCase();
  if (role !== undefined) {
    if (!['admin', 'developer', 'user'].includes(role)) {
      return res.status(400).json({ message: 'Role must be admin, developer, or user' });
    }
    updates.role = role;
  }
  if (status !== undefined) {
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Status must be pending, approved, or rejected' });
    }
    if (req.params.id === req.user._id.toString() && status !== 'approved') {
      return res.status(400).json({ message: 'Cannot suspend your own administrator account.' });
    }
    updates.status = status;
  }

  if (!updates.name && name !== undefined) return res.status(400).json({ message: 'Name is required.' });
  if (!updates.email && email !== undefined) return res.status(400).json({ message: 'Email is required.' });

  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      updates,
      { returnDocument: 'after', runValidators: true, select: '-password' }
    );
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @route DELETE /api/admin/users/:id
router.delete('/users/:id', async (req, res) => {
  if (req.params.id === req.user._id.toString()) {
    return res.status(400).json({ message: 'Cannot delete your own account.' });
  }
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ message: 'User deleted.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @route GET /api/admin/settings/visualization-year
router.get('/settings/visualization-year', async (req, res) => {
  try {
    const setting = await AppSetting.findOne({ key: PUBLISHED_WQM_YEAR_KEY });
    const year = Number(setting?.value || 2026);
    res.json({
      year: WQM_PUBLISHED_YEARS.includes(year) ? year : 2026,
      updatedAt: setting?.updatedAt || null,
      updatedBy: setting?.updatedBy || null,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @route PATCH /api/admin/settings/visualization-year
router.patch('/settings/visualization-year', async (req, res) => {
  const year = Number(req.body?.year);
  if (!WQM_PUBLISHED_YEARS.includes(year)) {
    return res.status(400).json({ message: 'Published WQM year must be 2024, 2025, or 2026.' });
  }

  try {
    const setting = await AppSetting.findOneAndUpdate(
      { key: PUBLISHED_WQM_YEAR_KEY },
      { key: PUBLISHED_WQM_YEAR_KEY, value: year, updatedBy: req.user._id },
      { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
    );
    res.json({
      year: Number(setting.value),
      updatedAt: setting.updatedAt,
      updatedBy: setting.updatedBy,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @route GET /api/admin/system
router.get('/system', (req, res) => {
  const dbState = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  res.json({
    nodeVersion: process.version,
    platform: os.platform(),
    uptime: Math.floor(process.uptime()),
    dbStatus: dbState[mongoose.connection.readyState] || 'unknown',
    dbName: mongoose.connection.name || '',
    memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    hostname: os.hostname(),
    env: process.env.NODE_ENV || 'development',
  });
});

module.exports = router;

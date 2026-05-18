const express = require('express');
const router = express.Router();
const os = require('os');
const mongoose = require('mongoose');
const User = require('../models/User');
const { protect } = require('../middleware/authMiddleware');
const { adminProtect } = require('../middleware/adminMiddleware');

// All routes require auth + admin
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
  if (!['admin', 'user'].includes(role)) {
    return res.status(400).json({ message: 'Role must be admin or user' });
  }
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { new: true, select: '-password' }
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
      { new: true, select: '-password' }
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

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');

// Mock water quality data — replace with real MongoDB collection later
const mockReadings = [
  { id: 1, location: 'Station A', ph: 7.2, turbidity: 1.5, temperature: 26.4, dissolved_oxygen: 8.1, date: '2026-04-22T08:00:00Z', status: 'normal' },
  { id: 2, location: 'Station B', ph: 6.8, turbidity: 3.2, temperature: 28.0, dissolved_oxygen: 6.9, date: '2026-04-22T08:00:00Z', status: 'warning' },
  { id: 3, location: 'Station C', ph: 7.5, turbidity: 0.8, temperature: 25.1, dissolved_oxygen: 9.0, date: '2026-04-22T08:00:00Z', status: 'normal' },
  { id: 4, location: 'Station D', ph: 5.2, turbidity: 8.9, temperature: 30.5, dissolved_oxygen: 4.2, date: '2026-04-22T08:00:00Z', status: 'critical' },
];

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

module.exports = router;

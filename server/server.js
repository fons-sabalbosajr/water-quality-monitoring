const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '..', 'front-end', '.env') });
const express = require('express');
const cors = require('cors');
const os = require('os');
const connectDB = require('./config/db');

const authRoutes = require('./routes/auth');
const waterQualityRoutes = require('./routes/waterQuality');
const adminRoutes = require('./routes/admin');

const app = express();

// Connect to MongoDB
connectDB();

// Resolve local machine LAN IP
const getLocalIP = () => {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
};

const LOCAL_IP = process.env.HOST || getLocalIP();
const FRONTEND_ORIGINS = [
  'http://localhost:5173',
  `http://${LOCAL_IP}:5173`,
];

// Middleware
app.use(
  cors({
    origin: FRONTEND_ORIGINS,
    credentials: true,
  })
);
// Full WQM year datasets (all waterbody sheets, stations and monthly readings)
// can be several MB, which exceeds body-parser's 100kb default. Raise the limit
// so saving/pushing a year's data does not fail with PayloadTooLargeError.
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/water', waterQualityRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/api/health', (req, res) =>
  res.json({ status: 'OK', message: 'Water Quality Monitoring API is running' })
);

// 404 handler
app.use((req, res) => res.status(404).json({ message: 'Route not found' }));

// Global error handler
app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large' || err?.status === 413) {
    return res.status(413).json({
      message: 'The data you are sending is too large. Please try again or contact an administrator.',
    });
  }
  console.error(err.stack);
  res.status(500).json({ message: 'Internal server error' });
});

const PORT = process.env.PORT || 5000;
// Bind to 0.0.0.0 so the server is reachable on LAN
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Server running:`);
  console.log(`  ➜  Local:    http://localhost:${PORT}`);
  console.log(`  ➜  Network:  http://${LOCAL_IP}:${PORT}\n`);
});

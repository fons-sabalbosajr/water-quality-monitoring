const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '..', 'front-end', '.env') });
const express = require('express');
const cors = require('cors');
const os = require('os');
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const { disconnectDB, isDbReady } = require('./config/db');

const authRoutes = require('./routes/auth');
const waterQualityRoutes = require('./routes/waterQuality');
const adminRoutes = require('./routes/admin');
const veraRoutes = require('./routes/vera');

// ── Fail fast on missing configuration ──────────────────────────────────────
// Previously a missing JWT_SECRET only surfaced as "token failed" 401s on every
// authenticated request, and a missing MONGO_URI as an immediate process.exit
// with no explanation. Validate up front with an actionable message.
const REQUIRED_ENV = ['MONGO_URI', 'JWT_SECRET'];
const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missingEnv.length) {
  console.error(`\n  Missing required environment variable(s): ${missingEnv.join(', ')}`);
  console.error('  Copy server/.env.example to server/.env and fill in the values.\n');
  process.exit(1);
}
if (process.env.JWT_SECRET.length < 32) {
  console.warn('  WARNING: JWT_SECRET is shorter than 32 characters. Use a long random secret in production.');
}

const app = express();

// Behind Nginx/Cloudflare the real client IP arrives in X-Forwarded-For.
// Without this, rate limiting and logging see the proxy IP for every request.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));
app.disable('x-powered-by');

// Resolve local machine LAN IP
const getLocalIP = () => {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
};

const LOCAL_IP = process.env.HOST || getLocalIP();

// Allowed browser origins. Dev hosts stay built in; production origins come
// from CORS_ORIGINS / CLIENT_URL so a deployed front-end is not blocked.
const FRONTEND_ORIGINS = [
  ...new Set(
    [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      `http://${LOCAL_IP}:5173`,
      process.env.CLIENT_URL,
      ...String(process.env.CORS_ORIGINS || '')
        .split(',')
        .map((origin) => origin.trim()),
    ]
      .filter(Boolean)
      .map((origin) => origin.replace(/\/+$/, '')),
  ),
];

app.use(
  cors({
    origin(origin, callback) {
      // Same-origin, curl, and server-to-server calls send no Origin header.
      if (!origin) return callback(null, true);
      if (FRONTEND_ORIGINS.includes(origin.replace(/\/+$/, ''))) return callback(null, true);
      // Reject without throwing: an Error here becomes an unhandled 500 instead
      // of a clean CORS failure the browser can report.
      return callback(null, false);
    },
    credentials: true,
    maxAge: 600,
  }),
);

// Minimal hardening without pulling in a new dependency.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Full WQM year datasets (all waterbody sheets, stations and monthly readings)
// can be several MB, which exceeds body-parser's 100kb default. Raise the limit
// so saving/pushing a year's data does not fail with PayloadTooLargeError.
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Reject writes while the database is unavailable with a retryable 503 instead
// of letting the request hang or fail with an opaque driver error.
app.use('/api', (req, res, next) => {
  if (req.path === '/health' || isDbReady()) return next();
  return res.status(503).json({
    message: 'Database is unavailable. Please retry in a moment.',
    code: 'DB_UNAVAILABLE',
  });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/water', waterQualityRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/vera', veraRoutes);

// Health check — reports DB state so uptime probes catch a half-up server.
app.get('/api/health', (req, res) => {
  const ready = isDbReady();
  res.status(ready ? 200 : 503).json({
    status: ready ? 'OK' : 'DEGRADED',
    message: 'Water Quality Monitoring API is running',
    db: ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] || 'unknown',
    uptime: Math.floor(process.uptime()),
  });
});

// 404 handler
app.use((req, res) => res.status(404).json({ message: 'Route not found' }));

// Global error handler — map known failure shapes to correct status codes so
// the client can distinguish "bad input" from "server broke".
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large' || err?.status === 413) {
    return res.status(413).json({
      message: 'The data you are sending is too large. Please try again or contact an administrator.',
    });
  }
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ message: 'Malformed JSON in request body.' });
  }
  if (err?.name === 'ValidationError') {
    return res.status(400).json({
      message: Object.values(err.errors || {}).map((e) => e.message).join(', ') || 'Validation failed.',
    });
  }
  if (err?.name === 'CastError') {
    return res.status(400).json({ message: `Invalid value for "${err.path}".` });
  }
  if (err?.code === 11000) {
    return res.status(409).json({ message: 'That record already exists.' });
  }
  if (err?.name === 'MongooseError' || err?.name === 'MongoNetworkError' || /buffering timed out|no connection/i.test(err?.message || '')) {
    return res.status(503).json({ message: 'Database is unavailable. Please retry in a moment.', code: 'DB_UNAVAILABLE' });
  }

  console.error(err.stack || err);
  return res.status(500).json({ message: 'Internal server error' });
});

const PORT = process.env.PORT || 5000;
let server;

const start = async () => {
  // Connect before accepting traffic so the first dashboard load does not race
  // an unconnected driver.
  await connectDB();

  // Bind to 0.0.0.0 so the server is reachable on LAN
  server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  Server running:`);
    console.log(`  ➜  Local:    http://localhost:${PORT}`);
    console.log(`  ➜  Network:  http://${LOCAL_IP}:${PORT}\n`);
  });

  // Drop sockets that go idle so a stalled client cannot pin a connection open.
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 70000;
  server.requestTimeout = 120000;
};

const shutdown = async (signal) => {
  console.log(`\n${signal} received — shutting down.`);
  try {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await disconnectDB();
  } catch (error) {
    console.error(`Shutdown error: ${error.message}`);
  } finally {
    process.exit(0);
  }
};

['SIGINT', 'SIGTERM'].forEach((signal) => process.on(signal, () => shutdown(signal)));

// A rejected promise that nobody handled used to take the process down with an
// unhelpful stack. Log it and keep serving; the error handler covers requests.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

start().catch((error) => {
  console.error(`\n  Failed to start server: ${error.message}\n`);
  process.exit(1);
});

module.exports = app;

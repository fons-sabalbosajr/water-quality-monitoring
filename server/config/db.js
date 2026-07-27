const mongoose = require('mongoose');

// Buffering hides connection problems: queries silently queue for 10s and then
// fail with an opaque timeout. Fail fast instead so route handlers return a
// real error the UI can act on.
mongoose.set('bufferCommands', false);
mongoose.set('strictQuery', true);

const CONNECT_OPTIONS = {
  // Fail a query fast when no healthy node is reachable rather than hanging
  // the HTTP request until the client gives up.
  serverSelectionTimeoutMS: 8000,
  socketTimeoutMS: 45000,
  connectTimeoutMS: 10000,
  // WQM year documents are multi-MB. A small pool avoids exhausting Atlas
  // connection limits while still serving concurrent dashboard loads.
  maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE || 10),
  minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE || 1),
  maxIdleTimeMS: 60000,
  retryWrites: true,
  heartbeatFrequencyMS: 10000,
};

let listenersBound = false;

const bindConnectionListeners = () => {
  if (listenersBound) return;
  listenersBound = true;

  mongoose.connection.on('connected', () => {
    console.log(`MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
  });
  // The driver reconnects on its own; log the transition so an operator can see
  // it in the process log instead of only seeing downstream 503s.
  mongoose.connection.on('disconnected', () => {
    console.warn('MongoDB disconnected — driver will retry automatically.');
  });
  mongoose.connection.on('reconnected', () => {
    console.log('MongoDB reconnected.');
  });
  mongoose.connection.on('error', (error) => {
    console.error(`MongoDB error: ${error.message}`);
  });
};

/**
 * Connect with bounded exponential backoff. The previous implementation called
 * process.exit(1) on the first failure, so a transient Atlas hiccup or a slow
 * network at boot permanently killed the API until someone restarted it.
 */
const connectDB = async ({ retries = 5, initialDelayMs = 1000 } = {}) => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is not set. Copy server/.env.example to server/.env and fill it in.');
  }

  bindConnectionListeners();

  let attempt = 0;
  let delay = initialDelayMs;

  for (;;) {
    try {
      await mongoose.connect(process.env.MONGO_URI, {
        ...CONNECT_OPTIONS,
        dbName: process.env.MONGO_DB_NAME,
      });
      return mongoose.connection;
    } catch (error) {
      attempt += 1;
      if (attempt > retries) {
        throw new Error(`MongoDB connection failed after ${retries} retries: ${error.message}`);
      }
      console.error(`MongoDB connection attempt ${attempt}/${retries} failed: ${error.message}. Retrying in ${delay}ms.`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 15000);
    }
  }
};

const disconnectDB = async () => {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.connection.close(false);
};

const isDbReady = () => mongoose.connection.readyState === 1;

module.exports = connectDB;
module.exports.connectDB = connectDB;
module.exports.disconnectDB = disconnectDB;
module.exports.isDbReady = isDbReady;

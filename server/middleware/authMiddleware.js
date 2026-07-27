const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');

/**
 * Short-lived cache of resolved users.
 *
 * Every authenticated request previously issued a findById round-trip, which
 * on a dashboard that fires 5-10 parallel calls meant 5-10 extra DB queries per
 * page load. A 15s TTL keeps that cost off the hot path while staying short
 * enough that a role change or suspension takes effect almost immediately.
 * Any write to a user (role/status/delete) clears the entry explicitly.
 */
const USER_CACHE_TTL_MS = 15000;
const userCache = new Map();

const cacheUser = (id, user) => {
  userCache.set(String(id), { user, expires: Date.now() + USER_CACHE_TTL_MS });
};

const invalidateUser = (id) => {
  userCache.delete(String(id));
};

const getCachedUser = (id) => {
  const key = String(id);
  const entry = userCache.get(key);
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    userCache.delete(key);
    return null;
  }
  return entry.user;
};

// Bound the cache so a long-running process with many accounts cannot grow it
// without limit.
const pruneCache = () => {
  if (userCache.size < 500) return;
  const now = Date.now();
  for (const [key, entry] of userCache) {
    if (entry.expires < now) userCache.delete(key);
  }
};

const protect = async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token', code: 'NO_TOKEN' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    // Distinguish expiry from tampering so the client can log out cleanly
    // instead of silently retrying with a dead token forever.
    const expired = error.name === 'TokenExpiredError';
    return res.status(401).json({
      message: expired ? 'Session expired. Please sign in again.' : 'Not authorized, token failed',
      code: expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
    });
  }

  if (!decoded?.id || !mongoose.Types.ObjectId.isValid(decoded.id)) {
    return res.status(401).json({ message: 'Not authorized, token failed', code: 'TOKEN_INVALID' });
  }

  try {
    let user = getCachedUser(decoded.id);
    if (!user) {
      // .lean() skips Mongoose document hydration — meaningful on a per-request
      // path where none of the document methods are used.
      user = await User.findById(decoded.id).select('-password -resetPasswordToken -resetPasswordExpires').lean();
      if (user) {
        pruneCache();
        cacheUser(decoded.id, user);
      }
    }

    if (!user) {
      return res.status(401).json({ message: 'User not found', code: 'USER_NOT_FOUND' });
    }

    // Previously a token issued before an account was rejected/suspended stayed
    // valid for its full 7-day life, so revoking access did nothing until the
    // token expired. Re-check status on every request.
    const status = user.status || 'approved';
    if (status !== 'approved') {
      invalidateUser(decoded.id);
      return res.status(403).json({
        message: status === 'pending'
          ? 'Your account is pending administrator approval.'
          : 'Your account is no longer active. Contact an administrator.',
        code: 'ACCOUNT_NOT_APPROVED',
      });
    }

    req.user = user;
    return next();
  } catch (error) {
    return next(error);
  }
};

module.exports = { protect, invalidateUser };

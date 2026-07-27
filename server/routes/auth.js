const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const transporter = require('../config/mailer');
const { protect } = require('../middleware/authMiddleware');
const {
  welcomeTemplate,
  forgotPasswordTemplate,
  passwordResetSuccessTemplate,
} = require('../templates/emailTemplates');

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;
const MIN_PASSWORD_LENGTH = 6;
const MAX_FIELD_LENGTH = 200;

// Generate JWT
const generateToken = (id) =>
  jwt.sign({ id: String(id) }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

// ── Brute-force throttle ────────────────────────────────────────────────────
// The login and reset endpoints were previously unthrottled, so an attacker
// could try passwords as fast as the server would answer. This is a small
// in-process fixed-window limiter — no new dependency, and adequate for a
// single-instance deployment. Behind multiple instances, move it to Redis.
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map();

const rateLimit = (max, keyFn) => (req, res, next) => {
  const key = `${req.path}:${keyFn(req)}`;
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
  } else if (entry.count >= max) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({
      message: `Too many attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`,
      code: 'RATE_LIMITED',
    });
  } else {
    entry.count += 1;
  }

  // Opportunistic sweep so the map cannot grow unbounded.
  if (attempts.size > 5000) {
    for (const [mapKey, value] of attempts) {
      if (value.resetAt < now) attempts.delete(mapKey);
    }
  }
  return next();
};

const clientKey = (req) => req.ip || req.socket?.remoteAddress || 'unknown';
const emailKey = (req) => `${clientKey(req)}:${String(req.body?.email || '').toLowerCase().trim()}`;
const clearAttempts = (req) => attempts.delete(`${req.path}:${emailKey(req)}`);

// Helper: send email without blocking the response. Mail delivery is slow and
// can fail; the caller's success no longer depends on it.
const sendMail = (to, { subject, html }) => {
  transporter
    .sendMail({ from: `"EMB WQMS" <${process.env.GMAIL_USER}>`, to, subject, html })
    .catch((err) => console.error('Mail error:', err.message));
};

const publicUser = (user, includeToken = false) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  status: user.status,
  ...(includeToken ? { token: generateToken(user._id) } : {}),
});

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public
router.post('/register', rateLimit(10, clientKey), async (req, res, next) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!name || !email || !password) {
    return res.status(400).json({ message: 'All fields are required' });
  }
  if (name.length > MAX_FIELD_LENGTH || email.length > MAX_FIELD_LENGTH) {
    return res.status(400).json({ message: 'Name or email is too long.' });
  }
  if (!EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ message: 'Enter a valid email address.' });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  try {
    const existing = await User.findOne({ email }).select('_id').lean();
    if (existing) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    const userCount = await User.estimatedDocumentCount();
    const role = userCount === 0 ? 'admin' : 'user';
    const status = userCount === 0 ? 'approved' : 'pending';
    const user = await User.create({ name, email, password, role, status });

    if (status === 'approved') {
      sendMail(user.email, welcomeTemplate({ name: user.name }));
      return res.status(201).json(publicUser(user, true));
    }

    return res.status(201).json({
      ...publicUser(user),
      message: 'Registration submitted. An administrator must approve your account before you can sign in.',
    });
  } catch (error) {
    // Two simultaneous signups with the same email both pass the findOne check;
    // the unique index catches the second one. Report it as a conflict, not a 500.
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'Email already registered' });
    }
    return next(error);
  }
});

// @route   POST /api/auth/login
// @desc    Authenticate user & return token
// @access  Public
router.post('/login', rateLimit(10, emailKey), async (req, res, next) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  try {
    const user = await User.findOne({ email });
    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const status = user.status || 'approved';
    if (status === 'pending') {
      return res.status(403).json({ message: 'Your account is pending administrator approval.' });
    }
    if (status !== 'approved') {
      return res.status(403).json({ message: 'Your account registration was not approved. Contact an administrator.' });
    }

    clearAttempts(req);
    return res.json(publicUser(user, true));
  } catch (error) {
    return next(error);
  }
});

// @route   GET /api/auth/me
// @desc    Get current logged-in user
// @access  Private
router.get('/me', protect, (req, res) => {
  res.json(req.user);
});

// @route   POST /api/auth/forgot-password
// @desc    Send password reset link to user's email
// @access  Public
router.post('/forgot-password', rateLimit(5, emailKey), async (req, res, next) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ message: 'Email is required' });

  const genericResponse = { message: 'If that email exists, a reset link has been sent.' };

  try {
    const user = await User.findOne({ email });
    // Always return the same response to prevent email enumeration.
    if (!user) return res.json(genericResponse);

    const token = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = crypto.createHash('sha256').update(token).digest('hex');
    user.resetPasswordExpires = Date.now() + 60 * 60 * 1000; // 1 hour
    await user.save({ validateBeforeSave: false });

    // Fire-and-forget: awaiting SMTP made the response time differ noticeably
    // between known and unknown addresses, which leaked account existence.
    sendMail(user.email, forgotPasswordTemplate({ name: user.name, resetToken: token }));

    return res.json(genericResponse);
  } catch (error) {
    return next(error);
  }
});

// @route   POST /api/auth/reset-password/:token
// @desc    Reset password using the token from email
// @access  Public
router.post('/reset-password/:token', rateLimit(10, clientKey), async (req, res, next) => {
  const password = String(req.body?.password || '');
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  const rawToken = String(req.params.token || '');
  if (!/^[a-f0-9]{64}$/i.test(rawToken)) {
    return res.status(400).json({ message: 'Reset link is invalid or has expired.' });
  }
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

  try {
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ message: 'Reset link is invalid or has expired.' });
    }

    user.password = password;
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await user.save();

    sendMail(user.email, passwordResetSuccessTemplate({ name: user.name }));

    return res.json({ message: 'Password reset successful. You can now log in.' });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;

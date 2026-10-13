const { rateLimit } = require('express-rate-limit');
const { MongoRateLimitStore } = require('../utils/mongoRateLimitStore');

// The phone app (routes/device.js) asks for news every ~25 s, all day. It gets its own limits, mounted BEFORE the
// site-wide limiter (server.js), so it can neither be locked out by nor use up the budget of everyone sharing its IP.
// `store` is for tests; production uses the shared MongoDB-backed store like every other limiter.
const windowMs = 15 * 60 * 1000;
const common = { windowMs, standardHeaders: true, legacyHeaders: false, passOnStoreError: false };

const createDeviceLimiter = ({ store } = {}) => rateLimit({
  ...common,
  max: 600,
  store: store || new MongoRateLimitStore({ prefix: 'device' }),
  message: { error: 'Too many requests, please try again later.' },
});

// Pairing codes are short-lived and single-use, but a guess is still a guess: few attempts per IP.
const createPairLimiter = ({ store } = {}) => rateLimit({
  ...common,
  max: 10,
  store: store || new MongoRateLimitStore({ prefix: 'devpair' }),
  message: { error: 'Too many pairing attempts, please try again later.' },
});

module.exports = { createDeviceLimiter, createPairLimiter };

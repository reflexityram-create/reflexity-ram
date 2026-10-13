const jwt = require('jsonwebtoken');
const User = require('../models/User');
const AdminDevice = require('../models/AdminDevice');

function authorizationHeader(req) {
  const headers = req.headers || {};
  const key = Object.keys(headers).find((name) => name.toLowerCase() === 'authorization');
  return key ? { present: true, value: headers[key] } : { present: false, value: undefined };
}

function bearerToken(value) {
  if (typeof value !== 'string') return null;
  const match = /^Bearer\s+(\S+)$/i.exec(value);
  return match ? match[1] : null;
}

function accessTokenFromRequest(req) {
  const header = authorizationHeader(req);
  // A supplied Authorization header is an explicit credential attempt. Never
  // silently switch to a cookie when it is malformed or invalid; that would let
  // a stale/cross-origin header change which identity authorizes the request.
  if (header.present) return { source: 'authorization', token: bearerToken(header.value) };
  return { source: 'cookie', token: req.cookies?.accessToken || null };
}

function requireExplicitBearer(req, res, next) {
  const header = authorizationHeader(req);
  if (!header.present || !bearerToken(header.value)) {
    return res.status(401).json({ error: 'Bearer authentication required' });
  }
  return next();
}

// Sessions the phone app minted for itself (routes/device.js) carry the id of the device in `dev`. Revoking the
// device must end them too, not only stop new ones, so those tokens are checked against it on every request.
async function deviceSessionRevoked(decoded, DeviceModel) {
  if (!decoded?.dev) return false;
  return !(await DeviceModel.exists({ _id: decoded.dev, revokedAt: null }));
}

function createAuthenticate({ jwtImpl = jwt, UserModel = User, DeviceModel = AdminDevice } = {}) {
  return async (req, res, next) => {
  try {
    const { token } = accessTokenFromRequest(req);

    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const decoded = jwtImpl.verify(token, process.env.JWT_SECRET);
    const user = await UserModel.findById(decoded.id).select('-password');

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'User not found or deactivated' });
    }
    if (Number(decoded.av ?? 0) !== Number(user.authVersion || 0) || await deviceSessionRevoked(decoded, DeviceModel)) {
      return res.status(401).json({ error: 'Session revoked', code: 'SESSION_REVOKED' });
    }

    req.user = user;
    req.authDeviceId = decoded.dev ? String(decoded.dev) : null;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
  };
}

/**
 * Verify JWT token from Authorization header or cookie.
 */
const authenticate = createAuthenticate();

/**
 * Optional authentication — attaches user if token present, but doesn't block
 */
function createOptionalAuth({ jwtImpl = jwt, UserModel = User, DeviceModel = AdminDevice } = {}) {
  return async (req, res, next) => {
    const header = authorizationHeader(req);
    const { token } = accessTokenFromRequest(req);
    try {
      if (!token) {
        if (header.present) return res.status(401).json({ error: 'Invalid token' });
        return next();
      }
      const decoded = jwtImpl.verify(token, process.env.JWT_SECRET);
      const user = await UserModel.findById(decoded.id).select('-password');
      if (!user || !user.isActive || Number(decoded.av ?? 0) !== Number(user.authVersion || 0)
        || await deviceSessionRevoked(decoded, DeviceModel)) {
        if (header.present) return res.status(401).json({ error: 'Invalid token' });
        return next();
      }
      req.user = user;
      return next();
    } catch (err) {
      if (header.present) return res.status(401).json({ error: 'Invalid token' });
      return next();
    }
  };
}

const optionalAuth = createOptionalAuth();

/**
 * Require admin role
 */
const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

/**
 * Routes that mint or manage long-lived credentials (pairing phones, promoting accounts) refuse a session that the phone
 * app minted for itself: a stolen phone must not be able to pair a second device or make another admin, because removing
 * the stolen phone would then leave those behind. The owner does these from a normal sign-in on the website.
 */
const denyDeviceSession = (req, res, next) => {
  if (req.authDeviceId) {
    return res.status(403).json({ error: 'Sign in on the website to do this. The phone app cannot.', code: 'DEVICE_SESSION_NOT_ALLOWED' });
  }
  return next();
};

/**
 * Generate access token
 */
const generateAccessToken = (userId, authVersion = 0) => {
  return jwt.sign({ id: userId, av: Number(authVersion) || 0 }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
};

/**
 * Set auth cookie
 */
const setAuthCookie = (res, token) => {
  res.cookie('accessToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
};

/**
 * Clear auth cookie
 */
const clearAuthCookie = (res) => {
  res.clearCookie('accessToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  });
};

module.exports = {
  authenticate,
  authorizationHeader,
  bearerToken,
  createAuthenticate,
  createOptionalAuth,
  optionalAuth,
  requireAdmin,
  requireExplicitBearer,
  denyDeviceSession,
  generateAccessToken,
  setAuthCookie,
  clearAuthCookie,
};

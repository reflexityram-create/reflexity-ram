const jwt = require('jsonwebtoken');
const User = require('../models/User');

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

function createAuthenticate({ jwtImpl = jwt, UserModel = User } = {}) {
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

    req.user = user;
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
const optionalAuth = async (req, res, next) => {
  try {
    const { token } = accessTokenFromRequest(req);

    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');
      if (user && user.isActive) {
        req.user = user;
      }
    }
  } catch (err) {
    // Silently ignore auth errors for optional auth
  }
  next();
};

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
 * Generate access token
 */
const generateAccessToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
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
  optionalAuth,
  requireAdmin,
  requireExplicitBearer,
  generateAccessToken,
  setAuthCookie,
  clearAuthCookie,
};

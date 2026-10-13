const crypto = require('crypto');
const AdminDevice = require('../models/AdminDevice');
const User = require('../models/User');
const { bearerToken, authorizationHeader } = require('./auth');

// `rfxd_` + 32 random bytes in base64url. Long enough that guessing is hopeless; the prefix lets logs and secret
// scanners tell a device token from other credentials.
const DEVICE_TOKEN_PATTERN = /^rfxd_[A-Za-z0-9_-]{43}$/;
const LAST_SEEN_EVERY_MS = 60 * 1000;

const hashDeviceToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const newDeviceToken = () => `rfxd_${crypto.randomBytes(32).toString('base64url')}`;

const deviceTokenFrom = (req) => {
  const header = authorizationHeader(req);
  const token = header.present ? bearerToken(header.value) : null;
  return token && DEVICE_TOKEN_PATTERN.test(token) ? token : null;
};

// Accepts only a paired, un-revoked device whose admin is still an active admin with the same authVersion (a
// password change, deactivation or role change bumps it, which also ends every paired phone).
function createAuthenticateDevice({ DeviceModel = AdminDevice, UserModel = User, now = Date.now } = {}) {
  return async (req, res, next) => {
    try {
      const token = deviceTokenFrom(req);
      if (!token) return res.status(401).json({ error: 'Device token required', code: 'DEVICE_TOKEN_REQUIRED' });

      const device = await DeviceModel.findOne({ tokenHash: hashDeviceToken(token), revokedAt: null });
      if (!device) return res.status(401).json({ error: 'This device is not paired (or was removed)', code: 'DEVICE_REVOKED' });

      const user = await UserModel.findById(device.user).select('-password');
      if (!user || !user.isActive || user.role !== 'admin'
        || Number(user.authVersion || 0) !== Number(device.authVersion || 0)) {
        return res.status(401).json({ error: 'This device is not paired (or was removed)', code: 'DEVICE_REVOKED' });
      }

      const seen = device.lastSeenAt ? new Date(device.lastSeenAt).getTime() : 0;
      if (now() - seen > LAST_SEEN_EVERY_MS) {
        await DeviceModel.updateOne({ _id: device._id }, { $set: { lastSeenAt: new Date(now()) } }).catch(() => {});
      }
      req.device = device;
      req.user = user;
      return next();
    } catch (err) {
      console.error('Device authentication error:', err.message);
      return res.status(500).json({ error: 'Could not check this device' });
    }
  };
}

module.exports = {
  DEVICE_TOKEN_PATTERN,
  createAuthenticateDevice,
  authenticateDevice: createAuthenticateDevice(),
  deviceTokenFrom,
  hashDeviceToken,
  newDeviceToken,
};

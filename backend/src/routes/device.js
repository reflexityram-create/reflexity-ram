const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const AdminDevice = require('../models/AdminDevice');
const AdminEvent = require('../models/AdminEvent');
const DevicePairing = require('../models/DevicePairing');
const User = require('../models/User');
const { authenticateDevice: defaultAuthenticateDevice, hashDeviceToken, newDeviceToken } = require('../middleware/deviceAuth');
const { eventWaiter, publicEvent, clip, recordAdminEvent } = require('../utils/adminEvents');

// ─── The phone app's API (paired devices only) ─────────────────────────────────
//   POST /api/device/pair     one-time code from the Security page -> a device token (stored on the phone)
//   POST /api/device/session  device token -> a 24 h admin session, so the app's web view is already signed in
//   GET  /api/device/events   new owner alerts; held open up to 30 s (long poll) so a new order arrives at once
// Mounted before the site-wide rate limiter (server.js): a phone polling every 25 s would eat a shared IP's budget.

const SESSION_TTL_SECONDS = 24 * 60 * 60;
const MAX_ACTIVE_DEVICES = 5;
const MAX_WAIT_SECONDS = 30;
const EVENT_PAGE = 50;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

// No 0/O, 1/I/L: the code is read off a screen. 31 symbols x 8 = about 39 bits, on top of the 10-minute life and
// the pairing rate limit.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const normalizePairingCode = (value) => (typeof value === 'string' ? value.toUpperCase().replace(/[^A-Z0-9]/g, '') : '');
// Keyed with a secret derived from JWT_SECRET (its own label, like utils/reviewLinks.js), not a bare hash: a code is only
// 39 bits, so someone who could read the pairing collection while a code is live could otherwise recover it offline.
const pairingKey = () => crypto.createHmac('sha256', process.env.JWT_SECRET || '').update('rfx-device-pairing-code-v1').digest();
const hashPairingCode = (normalized) => crypto.createHmac('sha256', pairingKey()).update(normalized).digest('hex');
const newPairingCode = () => {
  const chars = Array.from({ length: 8 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
};

const publicUser = (user) => ({
  id: String(user._id),
  email: user.email,
  firstName: user.firstName,
  lastName: user.lastName,
  role: user.role,
});

function createDeviceRouter({
  DeviceModel = AdminDevice,
  PairingModel = DevicePairing,
  UserModel = User,
  EventModel = AdminEvent,
  jwtImpl = jwt,
  authenticateDevice = defaultAuthenticateDevice,
  makeWaiter = eventWaiter,
  now = Date.now,
  record = recordAdminEvent,
  // Called (not awaited) on every poll: housekeeping that must happen even when no scheduled job runs (utils/etransfer.js).
  onPoll = null,
} = {}) {
  const router = express.Router();
  router.use(express.json({ limit: '4kb' }));
  // A body that is not JSON must not reach the site-wide error handler: it logs the error, and V8's message quotes the
  // start of the body, which here can be a pairing code.
  router.use((err, req, res, next) => {
    if (!err) return next();
    return res.status(err.status === 413 ? 413 : 400).json({ error: 'That request could not be read.' });
  });
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  // POST /api/device/pair
  router.post('/pair', async (req, res) => {
    try {
      const normalized = normalizePairingCode(req.body?.code);
      const refused = () => res.status(400).json({ error: 'That code is wrong or has expired. Make a new one on the Security page.' });
      if (normalized.length !== 8) return refused();

      const at = new Date(now());
      const pairing = await PairingModel.findOneAndUpdate(
        { codeHash: hashPairingCode(normalized), usedAt: null, expiresAt: { $gt: at } },
        { $set: { usedAt: at } },
        { returnDocument: 'before' },
      );
      if (!pairing) return refused();

      const user = await UserModel.findById(pairing.user).select('-password');
      if (!user || !user.isActive || user.role !== 'admin') return refused();

      const tooMany = () => res.status(409).json({ error: `${MAX_ACTIVE_DEVICES} phones are already paired. Remove one on the Security page first.` });
      if (await DeviceModel.countDocuments({ user: user._id, revokedAt: null }) >= MAX_ACTIVE_DEVICES) return tooMany();

      const token = newDeviceToken();
      const label = (typeof req.body?.label === 'string' && clip(req.body.label, 60)) || 'Phone';
      const device = await DeviceModel.create({
        user: user._id,
        label,
        tokenHash: hashDeviceToken(token),
        authVersion: Number(user.authVersion || 0),
        appVersion: (typeof req.body?.appVersion === 'string' && clip(req.body.appVersion, 40)) || undefined,
        lastSeenAt: at,
      });
      // The check above and this insert are two steps, so several codes redeemed at once could all pass it. Count again
      // now that this phone exists, and give this one up if the limit was passed.
      if (await DeviceModel.countDocuments({ user: user._id, revokedAt: null }) > MAX_ACTIVE_DEVICES) {
        await DeviceModel.updateOne({ _id: device._id }, { $set: { revokedAt: new Date(now()) } });
        return tooMany();
      }
      // The owner's phones (this one included) hear about every new phone: if it was not the owner, they know at once.
      await record({ type: 'device.paired', title: 'A new phone was paired', body: `"${label}" can now see your shop alerts and sign in as admin. Not you? Remove it on the Security page.`, priority: 'high', path: '/admin/security' });
      return res.status(201).json({ deviceId: String(device._id), token, user: publicUser(user) });
    } catch (err) {
      console.error('Device pairing error:', err.message);
      return res.status(500).json({ error: 'Could not pair this device' });
    }
  });

  // POST /api/device/session
  router.post('/session', authenticateDevice, async (req, res) => {
    try {
      // `dev` ties the session to this device: revoking the device ends it (middleware/auth.js).
      const accessToken = jwtImpl.sign(
        { id: req.user._id, av: Number(req.user.authVersion || 0), dev: req.device._id },
        process.env.JWT_SECRET,
        { expiresIn: SESSION_TTL_SECONDS },
      );
      return res.json({ accessToken, expiresInSeconds: SESSION_TTL_SECONDS, user: publicUser(req.user) });
    } catch (err) {
      console.error('Device session error:', err.message);
      return res.status(500).json({ error: 'Could not start a session' });
    }
  });

  // GET /api/device/events?after=<id>&wait=<seconds>
  // Without `after` it only returns the newest id (a cursor "from now"), so a freshly paired phone is not flooded
  // with history. With `after` it returns the events newer than that id, oldest first, and the cursor to use next.
  router.get('/events', authenticateDevice, async (req, res) => {
    let waiter = null;
    // Registered before anything is awaited: a phone that gives up during the first database read must not leave a
    // listener and a timer behind for the whole wait.
    let closed = false;
    res.on('close', () => { closed = true; if (waiter) waiter.cancel(); });
    try {
      if (typeof onPoll === 'function') Promise.resolve().then(onPoll).catch(() => {});

      const after = OBJECT_ID.test(String(req.query.after || '')) ? String(req.query.after) : null;
      if (!after) {
        const newest = await EventModel.findOne().sort({ _id: -1 }).select('_id').lean();
        const cursor = newest?._id || mongoose.Types.ObjectId.createFromTime(Math.floor(now() / 1000));
        return res.json({ events: [], cursor: String(cursor) });
      }

      const waitSeconds = Math.min(MAX_WAIT_SECONDS, Math.max(0, Number.parseInt(req.query.wait, 10) || 0));
      const read = () => EventModel.find({ _id: { $gt: after } }).sort({ _id: 1 }).limit(EVENT_PAGE).lean();

      // Register for the next event BEFORE reading, so one written in between still wakes this request.
      if (waitSeconds > 0) waiter = makeWaiter();
      let events = await read();
      if (closed) return undefined;
      if (!events.length && waiter) {
        await waiter.wait(waitSeconds * 1000);
        if (closed) return undefined;
        events = await read();
      }
      if (closed || res.destroyed) return undefined;
      return res.json({
        events: events.map(publicEvent),
        cursor: events.length ? String(events[events.length - 1]._id) : after,
      });
    } catch (err) {
      console.error('Device events error:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Could not read events' });
      return undefined;
    } finally {
      if (waiter) waiter.cancel();
    }
  });

  return router;
}

module.exports = {
  createDeviceRouter,
  newPairingCode,
  normalizePairingCode,
  hashPairingCode,
  publicUser,
  MAX_ACTIVE_DEVICES,
  SESSION_TTL_SECONDS,
};

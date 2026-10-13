const express = require('express');
const { param } = require('express-validator');
const mongoose = require('mongoose');
const AdminDevice = require('../models/AdminDevice');
const DevicePairing = require('../models/DevicePairing');
const { validate } = require('../middleware/validate');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { newPairingCode, normalizePairingCode, hashPairingCode } = require('./device');
const { recordAdminEvent } = require('../utils/adminEvents');

// ─── Phone app management (Security page) ─────────────────────────────────────
//   POST   /api/admin/devices/pairing     a one-time code for pairing a phone (valid 10 minutes)
//   GET    /api/admin/devices             the paired phones
//   DELETE /api/admin/devices/:id         remove a phone: its device token and any session it minted stop working
//   POST   /api/admin/devices/test-event  send a test alert to every paired phone
// Mounted before /api/admin (server.js), the same way the wholesale admin routes are.

const PAIRING_MINUTES = 10;
const MAX_OPEN_CODES = 5;

function createAdminDevicesRouter({
  DeviceModel = AdminDevice,
  PairingModel = DevicePairing,
  record = recordAdminEvent,
  now = Date.now,
  guard = [authenticate, requireAdmin],
} = {}) {
  const router = express.Router();
  router.use(...guard);
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.post('/pairing', async (req, res) => {
    try {
      const at = new Date(now());
      const open = await PairingModel.countDocuments({ user: req.user._id, usedAt: null, expiresAt: { $gt: at } });
      if (open >= MAX_OPEN_CODES) {
        return res.status(429).json({ error: 'Several pairing codes are already open. Use one of them or wait ten minutes.' });
      }
      const code = newPairingCode();
      const expiresAt = new Date(at.getTime() + PAIRING_MINUTES * 60 * 1000);
      await PairingModel.create({ user: req.user._id, codeHash: hashPairingCode(normalizePairingCode(code)), expiresAt });
      return res.status(201).json({ code, expiresAt });
    } catch (err) {
      console.error('Pairing code error:', err.message);
      return res.status(500).json({ error: 'Could not create a pairing code' });
    }
  });

  router.get('/', async (req, res) => {
    try {
      const devices = await DeviceModel.find({ user: req.user._id, revokedAt: null }).sort({ createdAt: -1 }).lean();
      return res.json({
        devices: devices.map((device) => ({
          id: String(device._id),
          label: device.label,
          appVersion: device.appVersion || null,
          pairedAt: device.createdAt,
          lastSeenAt: device.lastSeenAt || null,
        })),
      });
    } catch (err) {
      console.error('Device list error:', err.message);
      return res.status(500).json({ error: 'Could not list devices' });
    }
  });

  router.delete('/:id', [param('id').custom((value) => mongoose.Types.ObjectId.isValid(value)).withMessage('Invalid device id')], validate, async (req, res) => {
    try {
      const device = await DeviceModel.findOneAndUpdate(
        { _id: req.params.id, user: req.user._id, revokedAt: null },
        { $set: { revokedAt: new Date(now()) } },
        { returnDocument: 'after' },
      );
      if (!device) return res.status(404).json({ error: 'Device not found' });
      return res.json({ revoked: true });
    } catch (err) {
      console.error('Device revoke error:', err.message);
      return res.status(500).json({ error: 'Could not remove the device' });
    }
  });

  router.post('/test-event', async (req, res) => {
    const event = await record({
      type: 'test',
      title: 'Test alert',
      body: 'If you can read this, your phone is connected to the shop.',
      priority: 'normal',
      path: '/admin/orders',
    });
    if (!event) return res.status(500).json({ error: 'Could not record the test alert' });
    return res.status(201).json({ sent: true });
  });

  return router;
}

module.exports = { createAdminDevicesRouter, PAIRING_MINUTES, MAX_OPEN_CODES };

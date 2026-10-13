const mongoose = require('mongoose');

// A one-time code an admin creates (Security page) to pair the phone app. It is stored HASHED, works once, and
// expires after ten minutes; the app swaps it for a device token (routes/device.js POST /pair).
const devicePairingSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  codeHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  usedAt: { type: Date },
}, {
  collection: 'device_pairings',
  timestamps: true,
});

devicePairingSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('DevicePairing', devicePairingSchema);

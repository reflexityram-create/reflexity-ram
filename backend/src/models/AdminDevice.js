const mongoose = require('mongoose');

// A phone (or tablet) the owner paired with the admin panel. The app keeps a long random device token; only its
// SHA-256 lives here, so a database leak cannot be replayed. The token alone can do two things: ask for new admin
// events, and mint a short-lived admin session so the app's web view is already signed in (routes/device.js).
// Revoking (revokedAt) stops both at once, and so does an admin password change (authVersion no longer matches).
const adminDeviceSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  label: { type: String, required: true, trim: true, maxlength: 60 },
  tokenHash: { type: String, required: true, unique: true },
  // The admin's authVersion when the device was paired (User.authVersion): a password change or a role/active change bumps it.
  authVersion: { type: Number, default: 0 },
  appVersion: { type: String, trim: true, maxlength: 40 },
  lastSeenAt: { type: Date },
  revokedAt: { type: Date },
}, {
  collection: 'admin_devices',
  timestamps: true,
});

adminDeviceSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('AdminDevice', adminDeviceSchema);

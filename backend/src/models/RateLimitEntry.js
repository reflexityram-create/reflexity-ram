const mongoose = require('mongoose');

const rateLimitEntrySchema = new mongoose.Schema({
  _id: { type: String },
  hits: { type: Number, required: true, min: 0 },
  expiresAt: { type: Date, required: true },
}, {
  collection: 'rate_limits',
  versionKey: false,
});

rateLimitEntrySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RateLimitEntry', rateLimitEntrySchema);

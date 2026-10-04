const mongoose = require('mongoose');

// Buyers who asked to stop receiving review-request emails. Order and
// shipping emails are unaffected: they are part of the purchase itself.
const reviewEmailOptOutSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true, unique: true },
}, { timestamps: true });

module.exports = mongoose.model('ReviewEmailOptOut', reviewEmailOptOutSchema);

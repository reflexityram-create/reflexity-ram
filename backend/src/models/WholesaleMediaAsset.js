const mongoose = require('mongoose');
const { isWholesaleImage } = require('../utils/wholesaleLots');

const wholesaleMediaAssetSchema = new mongoose.Schema({
  publicId: { type: String, required: true, trim: true, unique: true, index: true, maxlength: 360 },
  url: { type: String, required: true, trim: true, maxlength: 2048 },
  state: { type: String, required: true, enum: ['available', 'claiming', 'attached', 'deleting', 'deleted'], default: 'available', index: true },
  lotId: { type: mongoose.Schema.Types.ObjectId, ref: 'WholesaleLot', default: null, index: true },
  claimId: { type: String, default: null, maxlength: 100, index: true },
  claimExpiresAt: { type: Date, default: null, index: true },
  deleteId: { type: String, default: null, maxlength: 100, index: true },
  deleteExpiresAt: { type: Date, default: null, index: true },
  deletedAt: { type: Date, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
}, {
  timestamps: true,
  strict: 'throw',
});

wholesaleMediaAssetSchema.pre('validate', function validateMediaAsset() {
  if (!isWholesaleImage({ url: this.url, publicId: this.publicId })) {
    this.invalidate('url', 'Wholesale media must be the exact Cloudinary asset for its public ID.');
  }
  if (this.state === 'attached' && !this.lotId) this.invalidate('lotId', 'Attached wholesale media requires a lot owner.');
  if (this.state === 'claiming' && (!this.claimId || !this.claimExpiresAt)) {
    this.invalidate('claimId', 'Claiming wholesale media requires a bounded claim.');
  }
  if (this.state === 'deleting' && (!this.deleteId || !this.deleteExpiresAt)) {
    this.invalidate('deleteId', 'Deleting wholesale media requires a bounded deletion claim.');
  }
});

wholesaleMediaAssetSchema.index({ state: 1, claimExpiresAt: 1 });
wholesaleMediaAssetSchema.index({ state: 1, deleteExpiresAt: 1 });

module.exports = mongoose.model('WholesaleMediaAsset', wholesaleMediaAssetSchema);

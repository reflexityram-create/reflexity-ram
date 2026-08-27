const mongoose = require('mongoose');
const { isWholesaleImage, publicationErrors } = require('../utils/wholesaleLots');

const imageSchema = new mongoose.Schema({
  url: { type: String, trim: true, maxlength: 2048 },
  publicId: { type: String, trim: true, maxlength: 360 },
  alt: { type: String, trim: true, maxlength: 180 },
}, { _id: false });

const wholesaleLotSchema = new mongoose.Schema({
  lotCode: { type: String, required: true, trim: true, uppercase: true, unique: true, index: true },
  title: { type: String, trim: true, maxlength: 180, default: '' },
  brand: { type: String, trim: true, maxlength: 100, default: '' },
  mpn: { type: String, trim: true, uppercase: true, maxlength: 120, default: '' },
  generation: { type: String, enum: ['DDR3', 'DDR4', 'DDR5', ''], default: '' },
  formFactor: { type: String, enum: ['UDIMM', 'SO-DIMM', 'RDIMM', 'LRDIMM', ''], default: '' },
  capacityLabel: { type: String, trim: true, maxlength: 40, default: '' },
  speedLabel: { type: String, trim: true, maxlength: 40, default: '' },
  rank: { type: String, trim: true, maxlength: 40, default: '' },
  condition: {
    type: String,
    enum: ['New', 'Open Box — Tested', 'Refurbished — Tested', 'Server Pull — Tested', 'Used', ''],
    default: '',
  },
  testStatus: { type: String, trim: true, maxlength: 120, default: '' },
  warranty: { type: String, trim: true, maxlength: 160, default: '' },
  unitPriceCad: {
    type: Number,
    min: 0.01,
    max: 1_000_000,
    validate: {
      validator: (value) => value == null || Math.round(value * 100) === value * 100,
      message: 'Wholesale unit price must use at most two decimal places.',
    },
  },
  quantityAvailable: { type: Number, min: 0, max: 1_000_000, default: 0, validate: Number.isInteger },
  minimumOrderQuantity: { type: Number, min: 1, max: 1_000_000, default: 1, validate: Number.isInteger },
  orderIncrement: { type: Number, min: 1, max: 1_000_000, default: 1, validate: Number.isInteger },
  shipFrom: { type: String, trim: true, maxlength: 120, default: '' },
  notes: { type: String, trim: true, maxlength: 2400, default: '' },
  image: { type: imageSchema, default: null },
  status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft', index: true },
  visibility: { type: String, enum: ['private', 'public'], default: 'private', index: true },
  quoteOnly: { type: Boolean, default: true, immutable: true },
  publishedAt: { type: Date, default: null, index: true },
  publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  unpublishedAt: { type: Date, default: null },
  archivedAt: { type: Date, default: null, index: true },
  archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  restoredAt: { type: Date, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, {
  timestamps: true,
  optimisticConcurrency: true,
  strict: 'throw',
});

wholesaleLotSchema.index({ status: 1, visibility: 1, archivedAt: 1, publishedAt: -1 });
// One Cloudinary wholesale asset can belong to at most one lot, including a
// private or archived lot. The partial index permits any number of image-less
// drafts while making media ownership authoritative in MongoDB.
wholesaleLotSchema.index(
  { 'image.publicId': 1 },
  { unique: true, partialFilterExpression: { 'image.publicId': { $type: 'string' } } },
);

// Route transitions are the normal publishing path, but the schema retains the
// invariant for any future internal writer that calls document.save().
wholesaleLotSchema.pre('validate', function validatePublishedLot() {
  if (this.image && !isWholesaleImage(this.image.toObject({ depopulate: true }))) {
    this.invalidate('image', 'Wholesale images must use the Reflexity wholesale media folder.');
  }
  if (this.status === 'published') {
    const errors = publicationErrors(this.toObject({ depopulate: true }));
    if (errors.length) this.invalidate('status', errors[0]);
    if (this.visibility !== 'public') this.invalidate('visibility', 'Published wholesale lots must be public.');
    if (this.quoteOnly !== true) this.invalidate('quoteOnly', 'Wholesale lots are quote-only.');
  }
});

module.exports = mongoose.model('WholesaleLot', wholesaleLotSchema);

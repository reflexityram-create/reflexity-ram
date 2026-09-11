const mongoose = require('mongoose');

// Editable informational pages. Legacy retail slugs remain for historical
// documents; B2B variants serve wholesale-facing copy.
// One document per page slug. Content is stored as sanitized HTML produced by
// the inline admin editor. If a page has no document yet, the frontend falls
// back to its built-in default content.
const pageContentSchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      enum: [
        'shipping', 'returns', 'warranty', 'faq', 'international',
        'shipping-b2b', 'returns-b2b', 'warranty-b2b', 'faq-b2b', 'international-b2b',
      ],
    },
    title: { type: String, required: true, trim: true },
    // Sanitized HTML body
    html: { type: String, default: '' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PageContent', pageContentSchema);

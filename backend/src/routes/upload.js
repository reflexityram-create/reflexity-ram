const express = require('express');
const {
  uploadProductImages,
  uploadProductImage,
  uploadWholesaleImageFile,
  uploadWholesaleImage,
  deleteImage,
  generateSignedUploadParams,
} = require('../config/cloudinary');
const { authenticate, requireAdmin } = require('../middleware/auth');
const WholesaleLot = require('../models/WholesaleLot');

const router = express.Router();

function requireExplicitBearer(req, res, next) {
  const authorization = req.get('authorization') || '';
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    return res.status(401).json({ error: 'Bearer authentication required' });
  }
  return next();
}

// ─── POST /api/upload/products ─────────────────────────────────────────────────
// Upload up to 5 product images (admin only)
router.post(
  '/products',
  authenticate,
  requireAdmin,
  (req, res, next) => {
    uploadProductImages.array('images', 5)(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: err.message });
      }
      next();
    });
  },
  async (req, res) => {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }
    const uploaded = [];
    try {
      for (const file of req.files) {
        const result = await uploadProductImage(file);
        uploaded.push({
          url: result.secure_url,
          publicId: result.public_id,
          alt: file.originalname,
        });
      }
      res.json({ images: uploaded });
    } catch (err) {
      await Promise.allSettled(uploaded.map((image) => deleteImage(image.publicId)));
      console.error('Cloudinary upload error:', err);
      res.status(502).json({ error: 'Image upload failed' });
    }
  }
);

// ─── DELETE /api/upload/products/:publicId ─────────────────────────────────────
router.delete('/products/:publicId', authenticate, requireAdmin, async (req, res) => {
  try {
    const publicId = decodeURIComponent(req.params.publicId);
    // Keep retail deletion ownership distinct from quote-only wholesale assets.
    if (!publicId.startsWith('reflexity-ram/products/')) {
      return res.status(400).json({ error: 'Invalid public ID' });
    }
    await deleteImage(publicId);
    res.json({ message: 'Image deleted' });
  } catch (err) {
    console.error('Image delete error:', err);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

// ─── POST /api/upload/wholesale ──────────────────────────────────────────────
// This quote-only lot upload is separately scoped and requires an explicit
// bearer. The legacy retail endpoint above is intentionally unchanged.
router.post(
  '/wholesale',
  requireExplicitBearer,
  authenticate,
  requireAdmin,
  (req, res, next) => {
    uploadWholesaleImageFile.single('image')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      return next();
    });
  },
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Choose one wholesale image to upload.' });
    try {
      const result = await uploadWholesaleImage(req.file);
      return res.status(201).json({
        image: { url: result.secure_url, publicId: result.public_id, alt: req.file.originalname.slice(0, 180) },
      });
    } catch (err) {
      console.error('Wholesale image upload error:', err);
      return res.status(502).json({ error: 'Wholesale image upload failed.' });
    }
  },
);

// ─── DELETE /api/upload/wholesale/:publicId ───────────────────────────────────
router.delete('/wholesale/:publicId', requireExplicitBearer, authenticate, requireAdmin, async (req, res) => {
  try {
    const publicId = decodeURIComponent(req.params.publicId);
    if (!publicId.startsWith('reflexity-ram/wholesale/')) {
      return res.status(400).json({ error: 'Invalid wholesale image ID' });
    }
    const referenced = await WholesaleLot.exists({ 'image.publicId': publicId });
    if (referenced) {
      return res.status(409).json({ error: 'That image is still attached to a wholesale listing.' });
    }
    await deleteImage(publicId);
    return res.json({ message: 'Wholesale image deleted' });
  } catch (err) {
    console.error('Wholesale image delete error:', err);
    return res.status(502).json({ error: 'Wholesale image delete failed.' });
  }
});

// ─── GET /api/upload/sign ──────────────────────────────────────────────────────
// Get signed params for direct client-side upload (optional flow)
router.get('/sign', authenticate, requireAdmin, (req, res) => {
  try {
    const params = generateSignedUploadParams();
    res.json(params);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate upload signature' });
  }
});

module.exports = router;

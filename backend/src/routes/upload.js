const express = require('express');
const {
  uploadProductImages,
  uploadProductImage,
  uploadWholesaleImageFile,
  uploadWholesaleImage,
  deleteImage,
  generateSignedUploadParams,
} = require('../config/cloudinary');
const { authenticate, requireAdmin, requireExplicitBearer } = require('../middleware/auth');
const WholesaleLot = require('../models/WholesaleLot');
const WholesaleMediaAsset = require('../models/WholesaleMediaAsset');
const { isWholesaleImage } = require('../utils/wholesaleLots');
const {
  finishWholesaleMediaDeletion,
  reserveWholesaleMediaDeletion,
} = require('../utils/wholesaleMedia');

function asLean(query) {
  return typeof query?.lean === 'function' ? query.lean() : query;
}

function isAvailableExactMedia(media, image) {
  return Boolean(media
    && media.publicId === image.publicId
    && media.url === image.url
    && media.state === 'available');
}

function isDefiniteNoCommitError(error) {
  return Boolean(error
    && (error.code === 11000
      || ['ValidationError', 'CastError', 'StrictModeError'].includes(error.name)));
}

async function registerWholesaleMedia({ MediaModel, image, createdBy }) {
  try {
    const media = await asLean(MediaModel.findOneAndUpdate(
      { publicId: image.publicId },
      {
        $setOnInsert: {
          publicId: image.publicId,
          url: image.url,
          state: 'available',
          createdBy,
        },
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    ));
    return { state: isAvailableExactMedia(media, image) ? 'registered' : 'conflict' };
  } catch (error) {
    // A timed-out upsert can still have committed. Only remove the fresh remote
    // asset after an authoritative read proves no registry row exists.
    try {
      const media = await asLean(MediaModel.findOne({ publicId: image.publicId }));
      if (isAvailableExactMedia(media, image)) return { state: 'registered', recovered: true };
      if (media) return { state: 'conflict', error };
      return { state: isDefiniteNoCommitError(error) ? 'missing' : 'uncertain', error };
    } catch (readError) {
      console.error('Wholesale media registration outcome check error:', readError);
      return { state: 'uncertain', error };
    }
  }
}

function createUploadRouter(dependencies = {}) {
  const authenticateRequest = dependencies.authenticate || authenticate;
  const requireAdminRequest = dependencies.requireAdmin || requireAdmin;
  const MediaModel = dependencies.WholesaleMediaAsset || WholesaleMediaAsset;
  const LotModel = dependencies.WholesaleLot || WholesaleLot;
  const deleteCloudinaryImage = dependencies.deleteImage || deleteImage;
  const uploadWholesale = dependencies.uploadWholesaleImage || uploadWholesaleImage;
  const uploadWholesaleFile = dependencies.uploadWholesaleImageFile || uploadWholesaleImageFile;
  const router = express.Router();

// ─── POST /api/upload/products ─────────────────────────────────────────────────
// Upload up to 5 product images (admin only)
router.post(
  '/products',
  authenticateRequest,
  requireAdminRequest,
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
      await Promise.allSettled(uploaded.map((image) => deleteCloudinaryImage(image.publicId)));
      console.error('Cloudinary upload error:', err);
      res.status(502).json({ error: 'Image upload failed' });
    }
  }
);

// ─── DELETE /api/upload/products/:publicId ─────────────────────────────────────
router.delete('/products/:publicId', authenticateRequest, requireAdminRequest, async (req, res) => {
  try {
    const publicId = decodeURIComponent(req.params.publicId);
    // Keep retail deletion ownership distinct from quote-only wholesale assets.
    if (!publicId.startsWith('reflexity-ram/products/')) {
      return res.status(400).json({ error: 'Invalid public ID' });
    }
    await deleteCloudinaryImage(publicId);
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
  authenticateRequest,
  requireAdminRequest,
  (req, res, next) => {
    uploadWholesaleFile.single('image')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      return next();
    });
  },
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Choose one wholesale image to upload.' });
    try {
      const result = await uploadWholesale(req.file);
      const image = { url: result.secure_url, publicId: result.public_id, alt: req.file.originalname.slice(0, 180) };
      if (!isWholesaleImage(image)) {
        try { await deleteCloudinaryImage(result.public_id); } catch (cleanupErr) { console.error('Invalid wholesale upload cleanup error:', cleanupErr); }
        return res.status(502).json({ error: 'Wholesale image upload returned an invalid asset.' });
      }
      const registration = await registerWholesaleMedia({
        MediaModel,
        image,
        createdBy: req.user._id,
      });
      if (registration.state === 'missing') {
        try { await deleteCloudinaryImage(image.publicId); } catch (cleanupErr) { console.error('Wholesale upload registry cleanup error:', cleanupErr); }
        console.error('Wholesale media registry error:', registration.error);
        return res.status(502).json({ error: 'Wholesale image upload could not be registered.' });
      }
      if (registration.state === 'uncertain') {
        console.error('Wholesale media registration is pending:', registration.error);
        return res.status(503).json({ error: 'Wholesale image registration is still being confirmed. Retry shortly.' });
      }
      if (registration.state === 'conflict') {
        return res.status(409).json({ error: 'That wholesale image ID is already reserved.' });
      }
      return res.status(201).json({
        image,
      });
    } catch (err) {
      console.error('Wholesale image upload error:', err);
      return res.status(502).json({ error: 'Wholesale image upload failed.' });
    }
  },
);

// ─── DELETE /api/upload/wholesale/:publicId ───────────────────────────────────
router.delete('/wholesale/:publicId', requireExplicitBearer, authenticateRequest, requireAdminRequest, async (req, res) => {
  try {
    const publicId = decodeURIComponent(req.params.publicId);
    if (!publicId.startsWith('reflexity-ram/wholesale/')) {
      return res.status(400).json({ error: 'Invalid wholesale image ID' });
    }
    const reservation = await reserveWholesaleMediaDeletion({
      MediaModel,
      WholesaleLotModel: LotModel,
      publicId,
    });
    if (reservation.state === 'missing') {
      return res.status(404).json({ error: 'Wholesale image not found.' });
    }
    if (reservation.state === 'attached') {
      return res.status(409).json({ error: 'That image is still attached to a wholesale listing.' });
    }
    if (reservation.state === 'busy') {
      return res.status(409).json({ error: 'That wholesale image is being attached or deleted. Try again shortly.' });
    }
    if (reservation.state === 'deleted') return res.json({ message: 'Wholesale image deleted' });
    try {
      await deleteCloudinaryImage(publicId);
    } catch (deleteErr) {
      // A transport error is ambiguous: Cloudinary may have completed the
      // deletion before the response was lost. Keep the durable deletion lease
      // so the now-absent asset can never become attachable. An idempotent retry
      // after the bounded lease can finish the registry transition safely.
      console.error('Wholesale image delete is pending:', deleteErr);
      return res.status(503).json({ error: 'Wholesale image deletion is pending. Retry shortly.' });
    }
    try {
      const finalized = await finishWholesaleMediaDeletion({ MediaModel, publicId, deleteId: reservation.deleteId });
      if (!finalized) {
        return res.status(503).json({ error: 'Wholesale image deletion is finishing. Retry shortly.' });
      }
    } catch (registryErr) {
      // Cloudinary deletion already succeeded. Retain the durable deleting
      // lease instead of making the now-absent asset attachable; a retry is
      // idempotent and can finish the registry state safely.
      console.error('Wholesale media deletion finalization error:', registryErr);
      return res.status(503).json({ error: 'Wholesale image deletion is finishing. Retry shortly.' });
    }
    return res.json({ message: 'Wholesale image deleted' });
  } catch (err) {
    console.error('Wholesale image delete error:', err);
    return res.status(502).json({ error: 'Wholesale image delete failed.' });
  }
});

// ─── GET /api/upload/sign ──────────────────────────────────────────────────────
// Get signed params for direct client-side upload (optional flow)
router.get('/sign', authenticateRequest, requireAdminRequest, (req, res) => {
  try {
    const params = generateSignedUploadParams();
    res.json(params);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate upload signature' });
  }
});

  return router;
}

const router = createUploadRouter();
module.exports = router;
module.exports.createUploadRouter = createUploadRouter;

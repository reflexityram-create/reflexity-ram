const express = require('express');
const mongoose = require('mongoose');
const WholesaleLot = require('../models/WholesaleLot');
const WholesaleMediaAsset = require('../models/WholesaleMediaAsset');
const { authenticate, requireAdmin, requireExplicitBearer } = require('../middleware/auth');
const {
  adminWholesaleLot,
  cleanWholesaleLotInput,
  makeLotCode,
  publicationErrors,
} = require('../utils/wholesaleLots');
const {
  claimWholesaleMedia,
  finalizeWholesaleMediaClaim,
  reconcileWholesaleMedia,
  releaseAttachedWholesaleMedia,
  releaseWholesaleMediaClaim,
} = require('../utils/wholesaleMedia');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

function readVersion(value) {
  const version = Number(value);
  return Number.isInteger(version) && version >= 0 ? version : null;
}

function readPositiveInteger(value, fallback, maximum) {
  if (value === undefined) return fallback;
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= maximum ? number : null;
}

function internalError(res, err, message) {
  if (err?.code === 11000) {
    const duplicateField = Object.keys(err.keyPattern || err.keyValue || {})[0];
    if (duplicateField === 'image.publicId') {
      return res.status(409).json({ error: 'That wholesale image is already attached to another listing.' });
    }
    return res.status(409).json({ error: 'That wholesale lot code is already in use.' });
  }
  if (err?.name === 'ValidationError') return res.status(400).json({ error: 'That wholesale lot contains invalid values.' });
  console.error(message, err);
  return res.status(500).json({ error: 'Unable to complete that wholesale action.' });
}

function asLean(query) {
  return typeof query?.lean === 'function' ? query.lean() : query;
}

function isDefiniteNoCommitError(error) {
  return Boolean(error
    && (error.code === 11000
      || ['ValidationError', 'CastError', 'StrictModeError'].includes(error.name)));
}

function idsEqual(left, right) {
  return String(left) === String(right);
}

async function hasAttachedWholesaleMedia({ Model, MediaModel, lotId, image }) {
  const media = await reconcileWholesaleMedia({
    MediaModel,
    WholesaleLotModel: Model,
    publicId: image.publicId,
  });
  return Boolean(media
    && media.state === 'attached'
    && idsEqual(media.lotId, lotId)
    && media.url === image.url);
}

async function confirmWholesaleMediaClaim({ Model, MediaModel, lotId, image, imageClaim }) {
  try {
    const finalized = await finalizeWholesaleMediaClaim({
      MediaModel,
      publicId: image.publicId,
      claimId: imageClaim.claimId,
      lotId,
    });
    if (finalized) return true;
  } catch (mediaErr) {
    // The finalization write itself can commit before a transport failure. The
    // authoritative reconciliation below determines the actual outcome.
    console.error('Wholesale media claim finalization check error', mediaErr);
  }
  try {
    return await hasAttachedWholesaleMedia({ Model, MediaModel, lotId, image });
  } catch (mediaErr) {
    console.error('Wholesale media ownership confirmation error', mediaErr);
    return false;
  }
}

async function recoverClaimAfterLotWriteError({ Model, MediaModel, lotId, image, imageClaim, writeError }) {
  let committedLot;
  try {
    committedLot = await asLean(Model.findOne({
      _id: lotId,
      'image.publicId': image.publicId,
      'image.url': image.url,
    }));
  } catch (readErr) {
    console.error('Wholesale lot write outcome check error', readErr);
    return { state: 'uncertain' };
  }

  if (committedLot) {
    const confirmed = await confirmWholesaleMediaClaim({
      Model,
      MediaModel,
      lotId,
      image,
      imageClaim,
    });
    return confirmed
      ? { state: 'committed', lot: committedLot }
      : { state: 'uncertain' };
  }

  // A transport/timeout rejection can race a delayed server-side commit even
  // when an immediate primary read returns null. Preserve the lease unless the
  // concrete error proves Mongo rejected the write before committing it.
  if (!isDefiniteNoCommitError(writeError)) return { state: 'uncertain' };

  try {
    const released = await releaseWholesaleMediaClaim({
      MediaModel,
      publicId: image.publicId,
      claimId: imageClaim.claimId,
    });
    return released ? { state: 'not_committed' } : { state: 'uncertain' };
  } catch (releaseErr) {
    console.error('Wholesale media recovery release error', releaseErr);
    return { state: 'uncertain' };
  }
}

async function allocateLotCode(Model) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const lotCode = makeLotCode();
    // The model-level unique index remains authoritative if a second request wins.
    // This check avoids presenting that collision during ordinary use.
    // eslint-disable-next-line no-await-in-loop
    const existing = await Model.exists({ lotCode });
    if (!existing) return lotCode;
  }
  throw new Error('Unable to allocate a wholesale lot code');
}

async function staleOrMissing(Model, id, res) {
  const existing = await Model.findById(id).select('_id').lean();
  return existing
    ? res.status(409).json({ error: 'This wholesale lot changed. Refresh it before saving again.' })
    : res.status(404).json({ error: 'Wholesale lot not found' });
}

function createAdminWholesaleRouter(dependencies = {}) {
  const Model = dependencies.WholesaleLot || WholesaleLot;
  const MediaModel = dependencies.WholesaleMediaAsset || WholesaleMediaAsset;
  const authenticateRequest = dependencies.authenticate || authenticate;
  const requireAdminRequest = dependencies.requireAdmin || requireAdmin;
  const router = express.Router();

  // These controls deliberately do not inherit cookie-only admin access from the
  // retail surface. The Stock Studio sends an explicit Authorization bearer.
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
  });
  router.use(requireExplicitBearer, authenticateRequest, requireAdminRequest);

  router.get('/', async (req, res) => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : 'all';
      const allowedStatuses = ['all', 'draft', 'published', 'archived'];
      if (!allowedStatuses.includes(status)) return res.status(400).json({ error: 'Invalid wholesale status filter' });
      const filter = status === 'all' ? {} : { status };
      const page = readPositiveInteger(req.query.page, 1, 100_000);
      const limit = readPositiveInteger(req.query.limit, 100, 100);
      if (page === null || limit === null) return res.status(400).json({ error: 'Invalid wholesale pagination' });
      const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : '';
      if (q) {
        const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.$or = ['lotCode', 'title', 'brand', 'mpn']
          .map((field) => ({ [field]: { $regex: escaped, $options: 'i' } }));
      }
      const [lots, total] = await Promise.all([
        Model.find(filter).sort({ updatedAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        Model.countDocuments(filter),
      ]);
      return res.json({
        lots: lots.map(adminWholesaleLot),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    } catch (err) {
      return internalError(res, err, 'List wholesale lots error');
    }
  });

  router.get('/:id', async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid wholesale lot ID' });
    try {
      const lot = await Model.findById(req.params.id).lean();
      if (!lot) return res.status(404).json({ error: 'Wholesale lot not found' });
      return res.json({ lot: adminWholesaleLot(lot) });
    } catch (err) {
      return internalError(res, err, 'Get wholesale lot error');
    }
  });

  router.post('/', async (req, res) => {
    const { data, errors } = cleanWholesaleLotInput(req.body);
    if (errors.length) return res.status(400).json({ error: errors[0] });
    const lotId = new mongoose.Types.ObjectId();
    let imageClaim = null;
    try {
      if (data.image) {
        imageClaim = await claimWholesaleMedia({
          MediaModel,
          WholesaleLotModel: Model,
          image: data.image,
          lotId,
        });
        if (!imageClaim) return res.status(409).json({ error: 'That wholesale image is not available to attach.' });
      }
      const lot = await Model.create({
        _id: lotId,
        ...data,
        lotCode: await allocateLotCode(Model),
        status: 'draft',
        visibility: 'private',
        quoteOnly: true,
        createdBy: req.user._id,
        updatedBy: req.user._id,
      });
      if (imageClaim) {
        const confirmed = await confirmWholesaleMediaClaim({
          Model,
          MediaModel,
          lotId,
          image: data.image,
          imageClaim,
        });
        if (!confirmed) {
          return res.status(503).json({ error: 'Wholesale listing was saved privately, but its image is not ready. Refresh and replace the image before publishing.' });
        }
      }
      return res.status(201).json({ lot: adminWholesaleLot(lot) });
    } catch (err) {
      if (imageClaim) {
        const recovery = await recoverClaimAfterLotWriteError({
          Model,
          MediaModel,
          lotId,
          image: data.image,
          imageClaim,
          writeError: err,
        });
        if (recovery.state === 'committed') {
          return res.status(201).json({ lot: adminWholesaleLot(recovery.lot) });
        }
        if (recovery.state === 'uncertain') {
          return res.status(503).json({ error: 'Wholesale listing save is still being confirmed. Refresh shortly.' });
        }
      }
      return internalError(res, err, 'Create wholesale lot error');
    }
  });

  router.patch('/:id', async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid wholesale lot ID' });
    const version = readVersion(req.body?.version);
    if (version === null) return res.status(400).json({ error: 'Refresh this wholesale lot before saving.' });
    const { data, errors } = cleanWholesaleLotInput(req.body);
    if (errors.length) return res.status(400).json({ error: errors[0] });
    if (!Object.keys(data).length) return res.status(400).json({ error: 'No wholesale fields were provided.' });
    let imageClaim = null;
    let previousImage = null;
    let changingImage = false;
    try {
      const current = await Model.findOne({ _id: req.params.id, __v: version }).lean();
      if (!current) return staleOrMissing(Model, req.params.id, res);
      if (current.status === 'archived') return res.status(409).json({ error: 'Restore this wholesale lot before editing it.' });
      previousImage = current.image || null;
      changingImage = Object.prototype.hasOwnProperty.call(data, 'image')
        && (!data.image || !previousImage
          || data.image.publicId !== previousImage.publicId
          || data.image.url !== previousImage.url);
      if (current.status === 'published') {
        if (changingImage) {
          return res.status(409).json({ error: 'Unpublish this wholesale lot before replacing or removing its image.' });
        }
        const publishErrors = publicationErrors({ ...current, ...data });
        if (publishErrors.length) return res.status(422).json({ error: publishErrors[0], details: publishErrors });
      }
      if (changingImage && data.image) {
        imageClaim = await claimWholesaleMedia({
          MediaModel,
          WholesaleLotModel: Model,
          image: data.image,
          lotId: current._id,
        });
        if (!imageClaim) return res.status(409).json({ error: 'That wholesale image is not available to attach.' });
      }
      const lot = await Model.findOneAndUpdate(
        { _id: req.params.id, __v: version, status: { $ne: 'archived' } },
        { $set: { ...data, updatedBy: req.user._id }, $inc: { __v: 1 } },
        { returnDocument: 'after', runValidators: true },
      ).lean();
      if (!lot) {
        if (imageClaim) {
          try { await releaseWholesaleMediaClaim({ MediaModel, publicId: data.image.publicId, claimId: imageClaim.claimId }); } catch (releaseErr) { console.error('Release stale wholesale media claim error', releaseErr); }
        }
        return staleOrMissing(Model, req.params.id, res);
      }
      const mediaConfirmed = !imageClaim || await confirmWholesaleMediaClaim({
        Model,
        MediaModel,
        lotId: current._id,
        image: data.image,
        imageClaim,
      });
      if (changingImage && previousImage) {
        try {
          await releaseAttachedWholesaleMedia({
            MediaModel,
            WholesaleLotModel: Model,
            publicId: previousImage.publicId,
            lotId: current._id,
          });
        } catch (mediaErr) {
          console.error('Release replaced wholesale media error', mediaErr);
        }
      }
      if (!mediaConfirmed) {
        return res.status(503).json({ error: 'Wholesale listing was saved privately, but its image is not ready. Refresh and replace the image before publishing.' });
      }
      return res.json({ lot: adminWholesaleLot(lot) });
    } catch (err) {
      if (imageClaim) {
        const recovery = await recoverClaimAfterLotWriteError({
          Model,
          MediaModel,
          lotId: req.params.id,
          image: data.image,
          imageClaim,
          writeError: err,
        });
        if (recovery.state === 'committed') {
          if (previousImage) {
            try {
              await releaseAttachedWholesaleMedia({
                MediaModel,
                WholesaleLotModel: Model,
                publicId: previousImage.publicId,
                lotId: req.params.id,
              });
            } catch (mediaErr) {
              console.error('Recover replaced wholesale media release error', mediaErr);
            }
          }
          return res.json({ lot: adminWholesaleLot(recovery.lot) });
        }
        if (recovery.state === 'uncertain') {
          return res.status(503).json({ error: 'Wholesale listing save is still being confirmed. Refresh shortly.' });
        }
      }
      return internalError(res, err, 'Update wholesale lot error');
    }
  });

  async function transition(req, res, action) {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid wholesale lot ID' });
    const version = readVersion(req.body?.version);
    if (version === null) return res.status(400).json({ error: 'Refresh this wholesale lot before changing its status.' });
    try {
      const current = await Model.findOne({ _id: req.params.id, __v: version }).lean();
      if (!current) return staleOrMissing(Model, req.params.id, res);
      const now = new Date();
      let expectedStatus;
      let set;
      if (action === 'publish') {
        if (current.status === 'archived') return res.status(409).json({ error: 'Restore this wholesale lot before publishing it.' });
        if (current.status === 'published') return res.status(409).json({ error: 'This wholesale lot is already published.' });
        const errors = publicationErrors(current);
        if (errors.length) return res.status(422).json({ error: errors[0], details: errors });
        let mediaReady;
        try {
          mediaReady = await hasAttachedWholesaleMedia({
            Model,
            MediaModel,
            lotId: current._id,
            image: current.image,
          });
        } catch (mediaErr) {
          console.error('Publish wholesale media ownership check error', mediaErr);
          return res.status(503).json({ error: 'Wholesale image ownership is still being confirmed. Retry shortly.' });
        }
        if (!mediaReady) {
          return res.status(409).json({ error: 'Replace this wholesale image before publishing the lot.' });
        }
        expectedStatus = 'draft';
        set = { status: 'published', visibility: 'public', quoteOnly: true, publishedAt: now, publishedBy: req.user._id, archivedAt: null, updatedBy: req.user._id };
      } else if (action === 'unpublish') {
        if (current.status !== 'published') return res.status(409).json({ error: 'Only a published wholesale lot can be unpublished.' });
        expectedStatus = 'published';
        set = { status: 'draft', visibility: 'private', quoteOnly: true, unpublishedAt: now, updatedBy: req.user._id };
      } else if (action === 'archive') {
        if (current.status === 'archived') return res.status(409).json({ error: 'This wholesale lot is already archived.' });
        expectedStatus = { $in: ['draft', 'published'] };
        set = { status: 'archived', visibility: 'private', quoteOnly: true, archivedAt: now, archivedBy: req.user._id, updatedBy: req.user._id };
      } else {
        if (current.status !== 'archived') return res.status(409).json({ error: 'Only an archived wholesale lot can be restored.' });
        expectedStatus = 'archived';
        set = { status: 'draft', visibility: 'private', quoteOnly: true, archivedAt: null, restoredAt: now, updatedBy: req.user._id };
      }
      const lot = await Model.findOneAndUpdate(
        { _id: req.params.id, __v: version, status: expectedStatus },
        { $set: set, $inc: { __v: 1 } },
        { returnDocument: 'after', runValidators: true },
      ).lean();
      if (!lot) return staleOrMissing(Model, req.params.id, res);
      return res.json({ lot: adminWholesaleLot(lot) });
    } catch (err) {
      return internalError(res, err, `${action} wholesale lot error`);
    }
  }

  router.post('/:id/publish', (req, res) => transition(req, res, 'publish'));
  router.post('/:id/unpublish', (req, res) => transition(req, res, 'unpublish'));
  router.delete('/:id', (req, res) => transition(req, res, 'archive'));
  router.post('/:id/restore', (req, res) => transition(req, res, 'restore'));

  return router;
}

const router = createAdminWholesaleRouter();
module.exports = router;
module.exports.createAdminWholesaleRouter = createAdminWholesaleRouter;

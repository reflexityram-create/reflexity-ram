const express = require('express');
const mongoose = require('mongoose');
const WholesaleLot = require('../models/WholesaleLot');
const { authenticate, requireAdmin } = require('../middleware/auth');
const {
  adminWholesaleLot,
  cleanWholesaleLotInput,
  makeLotCode,
  publicationErrors,
} = require('../utils/wholesaleLots');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

function requireExplicitBearer(req, res, next) {
  const authorization = req.get('authorization') || '';
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    return res.status(401).json({ error: 'Bearer authentication required' });
  }
  return next();
}

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
  if (err?.code === 11000) return res.status(409).json({ error: 'That wholesale lot code is already in use.' });
  if (err?.name === 'ValidationError') return res.status(400).json({ error: 'That wholesale lot contains invalid values.' });
  console.error(message, err);
  return res.status(500).json({ error: 'Unable to complete that wholesale action.' });
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
    try {
      const lot = await Model.create({
        ...data,
        lotCode: await allocateLotCode(Model),
        status: 'draft',
        visibility: 'private',
        quoteOnly: true,
        createdBy: req.user._id,
        updatedBy: req.user._id,
      });
      return res.status(201).json({ lot: adminWholesaleLot(lot) });
    } catch (err) {
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
    try {
      const current = await Model.findOne({ _id: req.params.id, __v: version }).lean();
      if (!current) return staleOrMissing(Model, req.params.id, res);
      if (current.status === 'archived') return res.status(409).json({ error: 'Restore this wholesale lot before editing it.' });
      if (current.status === 'published') {
        const publishErrors = publicationErrors({ ...current, ...data });
        if (publishErrors.length) return res.status(422).json({ error: publishErrors[0], details: publishErrors });
      }
      const lot = await Model.findOneAndUpdate(
        { _id: req.params.id, __v: version, status: { $ne: 'archived' } },
        { $set: { ...data, updatedBy: req.user._id }, $inc: { __v: 1 } },
        { returnDocument: 'after', runValidators: true },
      ).lean();
      if (!lot) return staleOrMissing(Model, req.params.id, res);
      return res.json({ lot: adminWholesaleLot(lot) });
    } catch (err) {
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
module.exports.requireExplicitBearer = requireExplicitBearer;

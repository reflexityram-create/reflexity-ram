const express = require('express');
const { body, param } = require('express-validator');
const PageContent = require('../models/PageContent');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { sanitizeHtml } = require('../utils/sanitizeHtml');

const router = express.Router();

const VALID_SLUGS = [
  'shipping', 'returns', 'warranty', 'faq', 'international',
  'shipping-b2b', 'returns-b2b', 'warranty-b2b', 'faq-b2b', 'international-b2b',
];

// ─── GET /api/pages/:slug — public ─────────────────────────────────────────────
// Returns the stored content for a page, or 204 if none exists yet (the
// frontend then renders its built-in default content).
router.get(
  '/:slug',
  [param('slug').isIn(VALID_SLUGS).withMessage('Unknown page')],
  validate,
  async (req, res) => {
    try {
      const page = await PageContent.findOne({ slug: req.params.slug });
      if (!page) return res.status(204).end();
      res.json({
        slug: page.slug,
        title: page.title,
        html: page.html,
        updatedAt: page.updatedAt,
      });
    } catch (err) {
      console.error('Get page content error:', err);
      res.status(500).json({ error: 'Failed to load page' });
    }
  }
);

// ─── PUT /api/pages/:slug — admin only ─────────────────────────────────────────
// Upserts the page content. HTML is sanitized server-side before saving.
router.put(
  '/:slug',
  authenticate,
  requireAdmin,
  [
    param('slug').isIn(VALID_SLUGS).withMessage('Unknown page'),
    body('html').isString().isLength({ max: 50000 }).withMessage('Content too long'),
    body('title').optional().isString().trim().isLength({ max: 120 }),
  ],
  validate,
  async (req, res) => {
    try {
      const clean = sanitizeHtml(req.body.html);
      const title = req.body.title?.trim() || req.params.slug;

      const page = await PageContent.findOneAndUpdate(
        { slug: req.params.slug },
        {
          slug: req.params.slug,
          title,
          html: clean,
          updatedBy: req.user._id,
        },
        { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
      );

      res.json({
        slug: page.slug,
        title: page.title,
        html: page.html,
        updatedAt: page.updatedAt,
      });
    } catch (err) {
      console.error('Save page content error:', err);
      res.status(500).json({ error: 'Failed to save page' });
    }
  }
);

// ─── DELETE /api/pages/:slug — admin only ──────────────────────────────────────
// Removes the saved override entirely so the page falls back to its built-in
// default content. This is the bulletproof "reset" — it wipes any bad saved
// HTML (e.g. content saved fully bold before the paste fix existed).
router.delete(
  '/:slug',
  authenticate,
  requireAdmin,
  [param('slug').isIn(VALID_SLUGS).withMessage('Unknown page')],
  validate,
  async (req, res) => {
    try {
      await PageContent.deleteOne({ slug: req.params.slug });
      res.json({ slug: req.params.slug, reset: true });
    } catch (err) {
      console.error('Reset page content error:', err);
      res.status(500).json({ error: 'Failed to reset page' });
    }
  }
);

module.exports = router;
module.exports.VALID_SLUGS = VALID_SLUGS;

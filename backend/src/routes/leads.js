const express = require('express');
const { body, matchedData, validationResult } = require('express-validator');
const { sendLeadEmail } = require('../utils/leads');
const WholesaleLot = require('../models/WholesaleLot');
const { publicWholesaleLot } = require('../utils/wholesaleLots');

const INTENTS = ['buy', 'sell', 'general'];
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WHOLESALE_LOT_ID = /^[a-f\d]{24}$/i;

const leadValidation = [
  body('intent').isString().trim().isIn(INTENTS),
  body('requestId').isString().trim().matches(REQUEST_ID).toLowerCase(),
  body('name').isString().trim().isLength({ min: 1, max: 100 }),
  body('company').optional({ checkFalsy: true }).isString().trim().isLength({ max: 120 }),
  body('email').isString().trim().isLength({ max: 254 }).isEmail(),
  body('phone').optional({ checkFalsy: true }).isString().trim().isLength({ max: 50 }),
  body('productType').isString().trim().isLength({ min: 1, max: 80 }),
  body('sourceType').optional({ checkFalsy: true }).isString().trim().isIn(['catalog-product', 'wholesale-lot']),
  body('sourceId').optional({ checkFalsy: true }).isString().trim().isLength({ max: 200 }),
  body('sourceCode').optional({ checkFalsy: true }).isString().trim().isLength({ max: 120 }),
  body('sku').optional({ checkFalsy: true }).isString().trim().isLength({ max: 120 }),
  body('itemTitle').optional({ checkFalsy: true }).isString().trim().isLength({ max: 180 }),
  body('manufacturer').optional({ checkFalsy: true }).isString().trim().isLength({ max: 80 }),
  body('partNumber').optional({ checkFalsy: true }).isString().trim().isLength({ max: 100 }),
  body('specification').optional({ checkFalsy: true }).isString().trim().isLength({ max: 180 }),
  body('quantity').optional({ checkFalsy: true }).isInt({ min: 1, max: 100000000 }).toInt(),
  body('condition').optional({ checkFalsy: true }).isString().trim().isLength({ max: 60 }),
  body('location').optional({ checkFalsy: true }).isString().trim().isLength({ max: 120 }),
  body('notes').optional({ checkFalsy: true }).isString().trim().isLength({ max: 2000 }),
  body('website').optional({ checkFalsy: true }).isString(),
];

function hasHoneypot(req) {
  return typeof req.body?.website === 'string' && req.body.website.trim().length > 0;
}

class LeadSourceError extends Error {}

async function canonicalizeLeadSource(lead, WholesaleLotModel) {
  if (lead.sourceType !== 'wholesale-lot') return lead;
  if (!WHOLESALE_LOT_ID.test(lead.sourceId || '')) throw new LeadSourceError('Invalid wholesale lot');
  const candidate = await WholesaleLotModel.findOne({
    _id: lead.sourceId,
    status: 'published',
    visibility: 'public',
    archivedAt: null,
    quoteOnly: true,
  }).lean();
  const lot = publicWholesaleLot(candidate);
  if (!lot) throw new LeadSourceError('Wholesale lot unavailable');
  return {
    ...lead,
    sourceId: lot.id,
    sourceCode: lot.lotCode,
    partNumber: lot.mpn,
    itemTitle: lot.title,
  };
}

function createLeadRouter({ sendLead = sendLeadEmail, WholesaleLotModel = WholesaleLot } = {}) {
  const router = express.Router();

  router.post(
    '/',
    (req, res, next) => {
      if (hasHoneypot(req)) return res.status(202).json({ success: true });
      next();
    },
    leadValidation,
    async (req, res) => {
      if (!validationResult(req).isEmpty()) {
        return res.status(400).json({ error: 'Please check the required fields and try again.' });
      }
      const lead = matchedData(req, { locations: ['body'], includeOptionals: true });
      delete lead.website;
      for (const [field, value] of Object.entries(lead)) {
        if (value === undefined) delete lead[field];
      }
      try {
        await sendLead(await canonicalizeLeadSource(lead, WholesaleLotModel));
        return res.status(202).json({ success: true });
      } catch (error) {
        if (error instanceof LeadSourceError) {
          return res.status(400).json({ error: 'The selected inventory is no longer available. Please refresh and try again.' });
        }
        // Provider responses and lead data may contain personal information.
        return res.status(502).json({ error: 'We could not submit your request. Please try again.' });
      }
    },
  );
  return router;
}

module.exports = { createLeadRouter, leadValidation, hasHoneypot, REQUEST_ID, canonicalizeLeadSource, LeadSourceError };

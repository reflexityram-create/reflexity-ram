const express = require('express');
const WholesaleLot = require('../models/WholesaleLot');
const { publicWholesaleLot } = require('../utils/wholesaleLots');

function createWholesaleRouter(Model = WholesaleLot) {
  const router = express.Router();

  // Customer inventory is fail-closed twice: Mongo narrows the candidate set,
  // then each record must pass the authoritative publication completeness check.
  router.get('/', async (req, res) => {
    try {
      const candidates = await Model.find({
        status: 'published',
        visibility: 'public',
        archivedAt: null,
        quoteOnly: true,
      }).sort({ publishedAt: -1, _id: -1 }).limit(100).lean();
      const lots = candidates.map(publicWholesaleLot).filter(Boolean);
      res.set('Cache-Control', 'no-store');
      return res.json({ lots });
    } catch (err) {
      console.error('Public wholesale list error', err);
      return res.status(503).json({ error: 'Wholesale inventory is temporarily unavailable.' });
    }
  });

  return router;
}

const router = createWholesaleRouter();
module.exports = router;
module.exports.createWholesaleRouter = createWholesaleRouter;

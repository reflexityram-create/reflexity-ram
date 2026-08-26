const express = require('express');
const WholesaleLot = require('../models/WholesaleLot');
const { publicWholesaleLot } = require('../utils/wholesaleLots');

const PUBLIC_LOT_LIMIT = 100;
const PUBLIC_CANDIDATE_LIMIT = 1000;

function createWholesaleRouter(Model = WholesaleLot) {
  const router = express.Router();

  // Customer inventory is fail-closed twice: Mongo narrows the candidate set,
  // then each record must pass the authoritative publication completeness check.
  router.get('/', async (req, res) => {
    try {
      const filter = {
        status: 'published',
        visibility: 'public',
        archivedAt: null,
        quoteOnly: true,
      };
      const lots = [];
      const batchSize = 100;
      let offset = 0;
      // Schema validation normally guarantees every candidate. This defensive
      // scan still fills the public page from later valid records if an old or
      // manually tampered record slips through the database predicate.
      while (lots.length < PUBLIC_LOT_LIMIT && offset < PUBLIC_CANDIDATE_LIMIT) {
        const readLimit = Math.min(batchSize, PUBLIC_CANDIDATE_LIMIT - offset);
        // eslint-disable-next-line no-await-in-loop
        const candidates = await Model.find(filter)
          .sort({ publishedAt: -1, _id: -1 })
          .skip(offset)
          .limit(readLimit)
          .lean();
        if (!candidates.length) break;
        for (const candidate of candidates) {
          const lot = publicWholesaleLot(candidate);
          if (lot) lots.push(lot);
          if (lots.length === PUBLIC_LOT_LIMIT) break;
        }
        offset += candidates.length;
        if (candidates.length < readLimit) break;
      }
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
module.exports.PUBLIC_CANDIDATE_LIMIT = PUBLIC_CANDIDATE_LIMIT;

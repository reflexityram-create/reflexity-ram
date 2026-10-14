const express = require('express');
const { query } = require('express-validator');
const { validate } = require('../middleware/validate');
const lookup = require('../utils/addressLookup');

// ─── Address suggestions for the e-Transfer form (utils/addressLookup.js) ──────────────────────────────────────────────────
//   GET /api/address/suggest?q=100 que[&lastId=CAN|...]   what the buyer typed -> up to 7 suggestions { id, text, description, next }
//   GET /api/address/retrieve?id=CAN|...                  a suggestion that finished an address -> { address: { line1, line2, city, state, zip[, zipHint] } }
//   (with the free provider, Photon, `zip` is always '' and `zipHint` is the postal area, the first three characters, of the street)
// Always HTTP 200 for a provider problem, with { unavailable: true }: the page then shows plain fields and the buyer types.
// The limits (per IP, and one daily cap on finished addresses for the whole site) are mounted in server.js before this router.

const seen = new Map();
// A provider problem is worth one log line an hour, not one per keystroke. Reason codes only: never the request or the key.
const reportProblem = (reason, now = Date.now()) => {
  if (reason === 'off' || reason === 'bad_id' || reason === 'incomplete' || reason === 'expired') return;
  if ((seen.get(reason) ?? 0) > now - 60 * 60 * 1000) return;
  seen.set(reason, now);
  console.error(`Address suggestions unavailable (${reason}); the form falls back to plain fields.`);
};

function createAddressRouter({ suggest = lookup.suggest, retrieve = lookup.retrieve } = {}) {
  const router = express.Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  router.get('/suggest', [
    query('q').isString().isLength({ max: 200 }),
    query('lastId').optional({ values: 'falsy' }).isString().isLength({ max: 80 }),
  ], validate, async (req, res) => {
    const out = await suggest({ query: req.query.q, lastId: req.query.lastId });
    if (!out.ok) {
      if (out.reason === 'bad_id') return res.status(400).json({ error: 'Invalid suggestion' });
      reportProblem(out.reason);
      return res.json({ suggestions: [], unavailable: true });
    }
    return res.json({ suggestions: out.suggestions });
  });

  router.get('/retrieve', [
    query('id').isString().isLength({ min: 3, max: 80 }),
  ], validate, async (req, res) => {
    const out = await retrieve({ id: req.query.id });
    if (!out.ok) {
      if (out.reason === 'bad_id') return res.status(400).json({ error: 'Invalid suggestion' });
      reportProblem(out.reason);
      return res.json({ unavailable: true });
    }
    return res.json({ address: out.address });
  });

  return router;
}

module.exports = { createAddressRouter, reportProblem };

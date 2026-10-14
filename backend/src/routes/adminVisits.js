const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');

// ─── The visit log, for the owner (docs/visit-log.md) ─────────────────────────────────────────────────────
//   GET /api/admin/visits           recent page views: IP address, place, network, device, page, referrer
//   GET /api/admin/visits/summary   totals, different IP addresses, top pages / countries / cities / networks / referrers
// The log itself lives in the `site-visits` Cloudflare Worker (D1). It is read here, server to server, with a Bearer token that only this
// service holds (VISITS_API_TOKEN), so the token never reaches a browser. Admin sessions only, the same guard as the orders list (which
// shows customers' names and addresses): the owner's phone app, whose web view is an admin session, can read it too. It only reads.
// Mounted before /api/admin (server.js), the same way the other admin routers are.

const PASS = new Set(['hours', 'site', 'ip', 'path', 'bots', 'limit']);

function createAdminVisitsRouter({
  fetchImpl = (...args) => fetch(...args),
  env = process.env,
  guard = [authenticate, requireAdmin],
  timeoutMs = 10000,
} = {}) {
  const router = express.Router();
  router.use(...guard);
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    next();
  });

  const read = (upstreamPath) => async (req, res) => {
    const token = env.VISITS_API_TOKEN;
    if (!token) return res.status(503).json({ error: 'The visit log is not connected to this server yet.' });
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query || {})) {
      if (PASS.has(key) && typeof value === 'string' && value) params.set(key, value.slice(0, 200));
    }
    const base = String(env.VISITS_API_URL || 'https://visits.reflexityram.com').replace(/\/+$/, '');
    try {
      const upstream = await fetchImpl(`${base}${upstreamPath}?${params}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'reflexity-admin' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!upstream.ok) {
        console.error(`Visit log answered ${upstream.status}`);
        return res.status(502).json({ error: 'The visit log did not answer.' });
      }
      return res.json(await upstream.json());
    } catch (err) {
      console.error('Visit log read failed:', err.message);
      return res.status(502).json({ error: 'The visit log did not answer.' });
    }
  };

  router.get('/', read('/api/visits'));
  router.get('/summary', read('/api/summary'));
  return router;
}

module.exports = { createAdminVisitsRouter };

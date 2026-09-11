function retiredRetailCommerce(_req, res) {
  res.status(410).set('Cache-Control', 'no-store').json({
    error: 'Direct retail checkout is no longer available. Please request a wholesale quote.',
  });
}

module.exports = { retiredRetailCommerce };

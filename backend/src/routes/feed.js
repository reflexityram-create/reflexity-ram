const express = require('express');

const router = express.Router();

function retiredFeed(_req, res) {
  res
    .status(410)
    .set('Cache-Control', 'no-store')
    .type('text/plain')
    .send('Retail product feeds are no longer available. Reflexity inventory is quote-only.');
}

// Consumer Merchant/RSS/CSV feeds were intentionally retired when the public
// site became a wholesale enquiry catalog. Product and order records remain.
router.get('/feed.xml', retiredFeed);
router.get('/feed.csv', retiredFeed);

module.exports = router;

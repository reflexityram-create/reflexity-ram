// Website orders ship within Canada with Canada Post (config/shipping.js).
// A stored https trackingUrl wins; otherwise customers get Canada Post's public
// tracking page for the number entered when the order was marked shipped.
const CANADA_POST_TRACKING_PAGE = 'https://www.canadapost-postescanada.ca/track-reperage/en#/details/';

const trackingUrlFor = ({ trackingNumber, trackingUrl } = {}) => {
  if (typeof trackingUrl === 'string' && /^https:\/\//i.test(trackingUrl.trim())) return trackingUrl.trim();
  const pin = typeof trackingNumber === 'string' ? trackingNumber.replace(/\s+/g, '') : '';
  return pin ? CANADA_POST_TRACKING_PAGE + encodeURIComponent(pin) : undefined;
};

module.exports = { CANADA_POST_TRACKING_PAGE, trackingUrlFor };

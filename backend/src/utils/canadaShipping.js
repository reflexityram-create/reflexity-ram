// ─── Faster delivery inside Canada ────────────────────────────────────────────
// What Canada Post charges (before tax) for each faster service to the buyer's postal
// code, cached for an hour per postal code and parcel size so a buyer trying a few
// options does not trigger a rating call each time. The flat standard rate stays the
// default and is not quoted here.

const { rateDomestic } = require('./canadaPost');
const { CANADA_SERVICES, parcelForSticks, SHIP_FROM_POSTAL_CODE } = require('../config/shipping');

const CACHE_MS = 60 * 60 * 1000;
const cache = new Map();

const cents = (value) => Math.round(value * 100) / 100;

// -> { options: [{ serviceCode, name, price, transitDays, guaranteed }], signaturePrice }
// `price` is without a signature; `signaturePrice` is what a signature on delivery adds (null if Canada Post did not price it).
const canadaOptions = async ({ postalCode, sticks, rate = rateDomestic, now = Date.now }) => {
  const parcel = parcelForSticks(sticks);
  const key = `${postalCode}:${parcel.weight}`;
  const hit = cache.get(key);
  if (hit && now() - hit.at < CACHE_MS) return hit.result;
  const quotes = await rate({
    postalCode,
    parcel,
    originPostalCode: SHIP_FROM_POSTAL_CODE,
    services: Object.keys(CANADA_SERVICES),
  });
  const priced = quotes.filter((q) => CANADA_SERVICES[q.serviceCode] && Number.isFinite(q.price) && q.price > 0);
  const signaturePrice = priced.map((q) => q.signaturePrice).find((value) => Number.isFinite(value)) ?? null;
  const options = priced.map((q) => ({
    serviceCode: q.serviceCode,
    name: CANADA_SERVICES[q.serviceCode],
    price: cents(q.price - (Number.isFinite(q.signaturePrice) ? q.signaturePrice : 0)),
    transitDays: q.transitDays,
    guaranteed: q.guaranteed,
  }));
  const result = { options, signaturePrice: Number.isFinite(signaturePrice) ? cents(signaturePrice) : null };
  cache.set(key, { at: now(), result });
  return result;
};

// "Xpresspost (about 2 business days)", plus " + signature on delivery" when one is added.
const canadaOptionLabel = (option, { signature = false } = {}) =>
  `${option.transitDays ? `${option.name} (about ${option.transitDays} business day${option.transitDays === 1 ? '' : 's'})` : option.name}${signature ? ' + signature on delivery' : ''}`;

const clearCanadaQuoteCacheForTest = () => cache.clear();

module.exports = { canadaOptions, canadaOptionLabel, clearCanadaQuoteCacheForTest };

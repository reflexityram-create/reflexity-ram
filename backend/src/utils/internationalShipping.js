// ─── Shipping options for buyers outside Canada ───────────────────────────────
// What Canada Post charges for the buyer's country (tracked services only),
// cached for an hour per country and parcel size so browsing buyers do not
// trigger a rating call each time.

const { rateInternational } = require('./canadaPost');
const { INTERNATIONAL_SERVICES, INTERNATIONAL_COUNTRIES, parcelForSticks, SHIP_FROM_POSTAL_CODE } = require('../config/shipping');

const CACHE_MS = 60 * 60 * 1000;
const cache = new Map();

const internationalOptions = async ({ country, sticks, rate = rateInternational, now = Date.now }) => {
  if (!INTERNATIONAL_COUNTRIES.includes(country)) throw new Error(`No website shipping to ${country}`);
  const parcel = parcelForSticks(sticks);
  const key = `${country}:${parcel.weight}`;
  const hit = cache.get(key);
  if (hit && now() - hit.at < CACHE_MS) return hit.options;
  const quotes = await rate({ countryCode: country, parcel, originPostalCode: SHIP_FROM_POSTAL_CODE });
  const options = Object.entries(INTERNATIONAL_SERVICES)
    .map(([serviceCode, name]) => {
      const quote = quotes.find((q) => q.serviceCode === serviceCode);
      return quote && Number.isFinite(quote.price) && quote.price > 0
        ? { serviceCode, name, price: Math.round(quote.price * 100) / 100, transitDays: quote.transitDays, guaranteed: quote.guaranteed }
        : null;
    })
    .filter(Boolean);
  cache.set(key, { at: now(), options });
  return options;
};

// "Tracked Packet – International (about 7 business days)" on Stripe's page and the order.
const optionLabel = (option) => (option.transitDays ? `${option.name} (about ${option.transitDays} business days)` : option.name);

const clearQuoteCacheForTest = () => cache.clear();

module.exports = { internationalOptions, optionLabel, clearQuoteCacheForTest };

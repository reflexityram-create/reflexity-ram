// The on/off switch for address suggestions, apart from the code that calls the provider (utils/addressLookup.js) so that the public
// payment-methods answer can read it without importing the e-Transfer code (which imports that answer: a cycle).
//
// Two providers, never both at once (a valid Canada Post key wins):
//   ADDRESSCOMPLETE_KEY=AA11-AA11-AA11-AA11   Canada Post AddressComplete key (paid, exact postal codes); its SHAPE is checked, so a stray value cannot switch it on
//   ADDRESS_SUGGEST_PHOTON=true               the free provider: Photon, open source, on OpenStreetMap data (street, city, province; NOT a reliable postal code)
//   ADDRESSCOMPLETE_BASE_URL / PHOTON_BASE_URL=...   where the service lives (default: the real one): tests, or our own Photon server
//   ADDRESS_LOOKUPS_PER_DAY=100               Canada Post only: most finished addresses (paid lookups) the whole site may pick in 24 hours (default 100, 10 to 2000)
//   PHOTON_SEARCHES_PER_DAY=3000              most searches the whole site may send to Photon in 24 hours (default 3000, 100 to 20000): the public
//                                             Photon server is free "for moderate use" and may block heavy users
const DEFAULT_BASE = 'https://ws1.postescanada-canadapost.ca/AddressComplete/Interactive';
const PHOTON_DEFAULT_BASE = 'https://photon.komoot.io';
const KEY_FORMAT = /^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/i;

const lookupConfig = (env = process.env) => {
  const key = String(env.ADDRESSCOMPLETE_KEY ?? '').trim();
  return { enabled: KEY_FORMAT.test(key), key, base: String(env.ADDRESSCOMPLETE_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '') };
};

const photonConfig = (env = process.env) => ({
  enabled: ['1', 'true', 'yes', 'on'].includes(String(env.ADDRESS_SUGGEST_PHOTON ?? '').trim().toLowerCase()),
  base: String(env.PHOTON_BASE_URL || PHOTON_DEFAULT_BASE).replace(/\/+$/, ''),
});

// Which service answers: 'canadapost', 'photon' or null (suggestions off: the buyer types the address).
const addressProvider = (env = process.env) => (lookupConfig(env).enabled ? 'canadapost' : photonConfig(env).enabled ? 'photon' : null);
const addressLookupEnabled = (env = process.env) => addressProvider(env) !== null;
// A middleware (a limiter) that only runs while the given provider answers: the daily cap on PAID lookups is Canada Post's alone,
// the daily cap on searches is Photon's alone. The provider is read per request.
const onlyWhenProvider = (provider, middleware, env = process.env) => (req, res, next) => (addressProvider(env) === provider ? middleware(req, res, next) : next());

const intInRange = (value, min, max, fallback) => {
  const text = String(value ?? '').trim();
  const parsed = Number(text);
  return text !== '' && Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};
const dailyLookupCap = (env = process.env) => intInRange(env.ADDRESS_LOOKUPS_PER_DAY, 10, 2000, 100);
const photonDailyCap = (env = process.env) => intInRange(env.PHOTON_SEARCHES_PER_DAY, 100, 20000, 3000);

module.exports = { DEFAULT_BASE, PHOTON_DEFAULT_BASE, KEY_FORMAT, lookupConfig, photonConfig, addressProvider, addressLookupEnabled, onlyWhenProvider, dailyLookupCap, photonDailyCap };

// The on/off switch for address suggestions, apart from the code that calls the provider (utils/addressLookup.js) so that the public
// payment-methods answer can read it without importing the e-Transfer code (which imports that answer: a cycle).
//
//   ADDRESSCOMPLETE_KEY=AA11-AA11-AA11-AA11   Canada Post AddressComplete key; its SHAPE is checked, so a stray value cannot switch it on
//   ADDRESSCOMPLETE_BASE_URL=...              tests only: where the two services live (default: Canada Post's)
//   ADDRESS_LOOKUPS_PER_DAY=100               most finished addresses (paid lookups) the whole site may pick in 24 hours (default 100, 10 to 2000)
const DEFAULT_BASE = 'https://ws1.postescanada-canadapost.ca/AddressComplete/Interactive';
const KEY_FORMAT = /^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/i;

const lookupConfig = (env = process.env) => {
  const key = String(env.ADDRESSCOMPLETE_KEY ?? '').trim();
  return { enabled: KEY_FORMAT.test(key), key, base: String(env.ADDRESSCOMPLETE_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '') };
};
const addressLookupEnabled = (env = process.env) => lookupConfig(env).enabled;

const dailyLookupCap = (env = process.env) => {
  const value = String(env.ADDRESS_LOOKUPS_PER_DAY ?? '').trim();
  const parsed = Number(value);
  return value !== '' && Number.isInteger(parsed) && parsed >= 10 && parsed <= 2000 ? parsed : 100;
};

module.exports = { DEFAULT_BASE, KEY_FORMAT, lookupConfig, addressLookupEnabled, dailyLookupCap };

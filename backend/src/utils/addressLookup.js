// Address suggestions for the e-Transfer form: Canada Post's AddressComplete, the address data Canada Post itself delivers by.
// It is called from OUR server (routes/address.js), never from the buyer's browser, so the key stays secret, the paid lookups can
// be capped, and the site's content security policy does not change. It is optional and fails SOFT: with no key, or on any problem
// at the provider, the buyer simply types the address into plain fields. Nothing here is stored or logged.
//
// The settings (key, test base URL, daily cap) are read in utils/addressConfig.js.
//
// Billing (docs/address-suggestions.md): typing (Find) is free; a lookup is counted when the buyer picks a finished address (Retrieve).

const { CA_PROVINCES, POSTAL_CODE, normalizePostalCode } = require('./etransfer');
const { lookupConfig, addressLookupEnabled } = require('./addressConfig');

const ID_FORMAT = /^[A-Za-z0-9|._-]{3,80}$/;
const PROVINCES = new Set(CA_PROVINCES);
const validLookupId = (id) => typeof id === 'string' && ID_FORMAT.test(id);

// What the buyer typed, made safe to send on: printable text only, single spaces, 80 characters at most.
const cleanQuery = (value) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

// One call to the provider. Returns { ok: true, items } or { ok: false, reason } and never throws: a reason is a short code
// ('off', 'timeout', 'network', 'http_503', 'provider_3' ...), never the URL (which carries the key).
async function call(path, params, { env = process.env, fetchImpl = fetch, timeoutMs = 4000 } = {}) {
  const { enabled, key, base } = lookupConfig(env);
  if (!enabled) return { ok: false, reason: 'off' };
  const url = new URL(`${base}/${path}`);
  url.searchParams.set('Key', key);
  for (const [name, value] of Object.entries(params)) if (value !== undefined && value !== '') url.searchParams.set(name, String(value));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) return { ok: false, reason: `http_${response.status}` };
    const body = await response.json();
    const items = Array.isArray(body) ? body : body?.Items;
    if (!Array.isArray(items)) return { ok: false, reason: 'shape' };
    // An error comes back as a single row with an Error number (2 unknown key, 3 out of credit, 8 daily limit, ...).
    const failure = items.find((item) => item && typeof item === 'object' && item.Error !== undefined);
    if (failure) return { ok: false, reason: `provider_${String(failure.Error).slice(0, 6)}` };
    return { ok: true, items };
  } catch (err) {
    return { ok: false, reason: err?.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

const text = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// Suggestions for what has been typed so far. `lastId` continues inside a container the buyer picked (a building or a street:
// "100 Queen St W, 12 addresses"), which is how a unit gets chosen. Each suggestion says whether picking it finishes the address.
async function suggest({ query, lastId } = {}, deps) {
  const term = cleanQuery(query);
  if (term.length < 3) return { ok: true, suggestions: [] };
  if (lastId !== undefined && lastId !== '' && !validLookupId(lastId)) return { ok: false, reason: 'bad_id' };
  const out = await call('Find/v2.10/json3.ws', { SearchTerm: term, LastId: lastId, Country: 'CAN', LanguagePreference: 'en', MaxSuggestions: 7 }, deps);
  if (!out.ok) return out;
  const suggestions = out.items
    .filter((item) => item && validLookupId(String(item.Id ?? '')) && text(item.Text, 120))
    .slice(0, 7)
    .map((item) => ({ id: String(item.Id), text: text(item.Text, 120), description: text(item.Description, 120), next: item.Next === 'Retrieve' ? 'retrieve' : 'find' }));
  return { ok: true, suggestions };
}

// The finished address in the shape of our form, or null when it is not one we can ship to (not Canada, no street, no postal code).
function toAddress(items) {
  const rows = (Array.isArray(items) ? items : []).filter((item) => item && typeof item === 'object');
  const row = rows.find((item) => /^en/i.test(String(item.Language ?? ''))) || rows[0];
  if (!row) return null;
  const country = String(row.CountryIso2 || row.CountryIso3 || '').toUpperCase();
  if (country && country !== 'CA' && country !== 'CAN') return null;
  const state = String(row.ProvinceCode || row.Province || '').toUpperCase();
  const line1 = text(row.Line1 || [row.BuildingNumber, row.Street].filter(Boolean).join(' '), 120);
  const city = text(row.City, 80);
  const zip = normalizePostalCode(row.PostalCode);
  if (!PROVINCES.has(state) || !POSTAL_CODE.test(zip) || line1.length < 3 || city.length < 2) return null;
  return { line1, line2: text(row.Line2, 120), city, state, zip, label: text(String(row.Label ?? '').split('\n').join(', '), 200) };
}

async function retrieve({ id } = {}, deps) {
  if (!validLookupId(id)) return { ok: false, reason: 'bad_id' };
  const out = await call('Retrieve/v2.11/json3.ws', { Id: id }, deps);
  if (!out.ok) return out;
  const address = toAddress(out.items);
  return address ? { ok: true, address } : { ok: false, reason: 'incomplete' };
}

module.exports = { addressLookupEnabled, lookupConfig, validLookupId, cleanQuery, suggest, retrieve, toAddress };

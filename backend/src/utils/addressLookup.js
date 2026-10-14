// Address suggestions for the e-Transfer form, from one of two providers (the choice is made in utils/addressConfig.js):
//   - Canada Post's AddressComplete, the address data Canada Post itself delivers by (paid; exact postal codes), or
//   - Photon (https://photon.komoot.io), the open-source geocoder on OpenStreetMap data (free, "moderate use"; good street, city and
//     province, but its postal codes are only approximate, so they are NEVER filled in: see "Photon" below).
// Both are called from OUR server (routes/address.js), never from the buyer's browser, so a key stays secret, the lookups can be
// capped, and the site's content security policy does not change. Both are optional and fail SOFT: with the provider off, or on any
// problem at the provider, the buyer simply types the address into plain fields. Nothing here is stored or logged.
//
// Billing for Canada Post (docs/address-suggestions.md): typing (Find) is free; a lookup is counted when the buyer picks a finished
// address (Retrieve).

const crypto = require('node:crypto');
const { CA_PROVINCES, POSTAL_CODE, normalizePostalCode } = require('./etransfer');
const { lookupConfig, photonConfig, addressProvider, addressLookupEnabled } = require('./addressConfig');

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
async function suggestCanadaPost({ query, lastId } = {}, deps) {
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

async function retrieveCanadaPost({ id } = {}, deps) {
  if (!validLookupId(id)) return { ok: false, reason: 'bad_id' };
  const out = await call('Retrieve/v2.11/json3.ws', { Id: id }, deps);
  if (!out.ok) return out;
  const address = toAddress(out.items);
  return address ? { ok: true, address } : { ok: false, reason: 'incomplete' };
}

// ─── Photon: the free provider ────────────────────────────────────────────────────────────────────────────────────────────────
// Measured 2026-10-14 against the public server (docs/address-suggestions.md): 48 of 50 ordinary Toronto addresses drawn at random from the
// City's open address file came back at house-number level, and every hit carried a postal code. But of 20 well-known addresses across
// Canada, 18 were found and only 10 of those had the exact postal code: 7 of the other 8 were right only in the first three characters,
// and one (2 Wellington St W, Brampton) was in another postal area (L6W for L6Y). So the postal code is never filled in from OpenStreetMap. What is passed on is `zipHint`, the first three characters (the postal area), which the form uses only
// to warn the buyer when the postal code they typed belongs to another area.
const PHOTON_AGENT = 'ReflexityRAM-address-suggestions/1.0 (https://reflexityram.com; reflexityram@gmail.com)';
// Canada's bounding box (west, south, east, north). It still lets in a strip of the northern United States, so results are also filtered by country.
const CANADA_BBOX = '-141.1,41.6,-52.5,83.2';
const PROVINCE_BY_NAME = {
  alberta: 'AB', 'british columbia': 'BC', 'colombie-britannique': 'BC', manitoba: 'MB', 'new brunswick': 'NB', 'nouveau-brunswick': 'NB',
  'newfoundland and labrador': 'NL', 'terre-neuve-et-labrador': 'NL', 'northwest territories': 'NT', 'territoires du nord-ouest': 'NT',
  'nova scotia': 'NS', 'nouvelle-écosse': 'NS', nunavut: 'NU', ontario: 'ON', 'prince edward island': 'PE', 'île-du-prince-édouard': 'PE',
  quebec: 'QC', 'québec': 'QC', saskatchewan: 'SK', yukon: 'YT', 'yukon territory': 'YT',
};

// "100 Queen St W" and "100 Queen Street West" are one address: compare streets with the usual abbreviations spelled out.
const ABBREVIATIONS = {
  st: 'street', ave: 'avenue', av: 'avenue', rd: 'road', dr: 'drive', blvd: 'boulevard', cres: 'crescent', crt: 'court', ct: 'court', pl: 'place',
  ln: 'lane', trl: 'trail', cir: 'circle', pkwy: 'parkway', hwy: 'highway', terr: 'terrace', sq: 'square',
  n: 'north', s: 'south', e: 'east', w: 'west',
};
const spelledOut = (value) => (String(value ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).map((token) => ABBREVIATIONS[token] || token).join(' ');

// A suggestion the buyer can still pick: kept for a few minutes, so that picking it needs no second call and carries nothing from the
// browser. The same address (identical in every field, from any search) shares one entry, and an entry that is shown again moves to the
// back of the line: typing that address again keeps it, and one visitor's burst of searches cannot easily push out what another buyer
// is about to pick. 5,000 entries are about 2 MB. A pick that finds nothing says "type it below".
const REMEMBER_MS = 15 * 60 * 1000;
const REMEMBER_MAX = 5000;
const remembered = new Map();   // id -> { at, address, key }, least recently shown first
const idByKey = new Map();      // the address as JSON -> id
function forget(id) {
  const entry = remembered.get(id);
  if (entry) idByKey.delete(entry.key);
  remembered.delete(id);
}
function remember(address, now = Date.now()) {
  for (const [id, entry] of remembered) if (now - entry.at > REMEMBER_MS) forget(id);
  const key = JSON.stringify(address);
  const known = idByKey.get(key);
  if (known && remembered.has(known)) {
    remembered.delete(known);
    remembered.set(known, { at: now, address, key });
    return known;
  }
  while (remembered.size >= REMEMBER_MAX) forget(remembered.keys().next().value);
  const id = `ph_${crypto.randomBytes(9).toString('base64url')}`;
  remembered.set(id, { at: now, address, key });
  idByKey.set(key, id);
  return id;
}

// One Photon search. Returns { ok: true, features } or { ok: false, reason } and never throws; a reason is a short code, never the URL.
async function photonCall(term, { env = process.env, fetchImpl = fetch, timeoutMs = 4000 } = {}) {
  const { enabled, base } = photonConfig(env);
  if (!enabled) return { ok: false, reason: 'off' };
  let url;
  try {
    url = new URL(`${base}/api/`);
  } catch {
    return { ok: false, reason: 'config' };   // a mistyped PHOTON_BASE_URL: soft like any other problem, and logged by the route
  }
  url.searchParams.set('q', term);
  url.searchParams.set('limit', '10');
  url.searchParams.set('lang', 'en');
  url.searchParams.set('layer', 'house');
  url.searchParams.set('bbox', CANADA_BBOX);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers: { Accept: 'application/json', 'User-Agent': PHOTON_AGENT } });
    if (!response.ok) return { ok: false, reason: `http_${response.status}` };
    const body = await response.json();
    if (!Array.isArray(body?.features)) return { ok: false, reason: 'shape' };
    return { ok: true, features: body.features };
  } catch (err) {
    return { ok: false, reason: err?.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

// One Photon result in the shape of our form, or null when it is not a Canadian street address with a house number.
function toPhotonAddress(feature) {
  const props = feature && typeof feature === 'object' ? feature.properties : null;
  if (!props || String(props.countrycode ?? '').toUpperCase() !== 'CA') return null;
  const number = text(props.housenumber, 16);
  const street = text(props.street, 80);
  const city = text(props.city || props.locality || props.district || props.county, 80);
  const state = PROVINCE_BY_NAME[String(props.state ?? '').trim().toLowerCase()];
  if (!/\d/.test(number) || street.length < 2 || city.length < 2 || !PROVINCES.has(state)) return null;
  const zip = normalizePostalCode(props.postcode);
  const line1 = `${number} ${street}`;
  return { line1, line2: '', city, state, zip: '', ...(POSTAL_CODE.test(zip) ? { zipHint: zip.slice(0, 3) } : {}), label: `${line1}, ${city}, ${state}` };
}

async function suggestPhoton({ query } = {}, deps = {}) {
  const term = cleanQuery(query);
  // Nothing to suggest before a house number is typed (the house layer would answer with named buildings), and no call is wasted on it.
  if (term.length < 3 || !/\d/.test(term)) return { ok: true, suggestions: [] };
  const out = await photonCall(term, deps);
  if (!out.ok) return out;
  const seen = new Set();
  const suggestions = [];
  for (const feature of out.features) {
    const address = toPhotonAddress(feature);
    if (!address) continue;
    const key = `${spelledOut(address.line1)}|${spelledOut(address.city)}|${address.state}`;
    if (seen.has(key)) continue;   // OpenStreetMap often has the same address twice (the building and its entrance)
    seen.add(key);
    suggestions.push({ id: remember(address, deps.now?.()), text: address.line1, description: `${address.city}, ${address.state}`, next: 'retrieve' });
    if (suggestions.length === 5) break;
  }
  return { ok: true, suggestions };
}

function retrievePhoton({ id } = {}, deps = {}) {
  if (!validLookupId(id)) return { ok: false, reason: 'bad_id' };
  const entry = remembered.get(id);
  if (!entry || (deps.now?.() ?? Date.now()) - entry.at > REMEMBER_MS) return { ok: false, reason: 'expired' };
  return { ok: true, address: { ...entry.address } };
}

// The two entry points the routes call: whichever provider is on.
const providerOf = (deps) => addressProvider(deps?.env || process.env);
const suggest = (args = {}, deps = {}) => (providerOf(deps) === 'photon' ? suggestPhoton(args, deps) : suggestCanadaPost(args, deps));
const retrieve = async (args = {}, deps = {}) => (providerOf(deps) === 'photon' ? retrievePhoton(args, deps) : retrieveCanadaPost(args, deps));

module.exports = {
  addressLookupEnabled, lookupConfig, validLookupId, cleanQuery, suggest, retrieve, toAddress,
  toPhotonAddress, suggestPhoton, retrievePhoton, photonCall, remember, remembered, idByKey, PROVINCE_BY_NAME, CANADA_BBOX, REMEMBER_MS, REMEMBER_MAX,
};

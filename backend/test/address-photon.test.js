// The free address provider for the e-Transfer form: Photon (open source, OpenStreetMap data). No test reaches the real server: the answers
// are REAL ones saved on 2026-10-14 (test/fixtures/photon-*.json: duplicates, a Connecticut result among the Canadian ones, French
// street names), served by a fake fetch. What matters: it only suggests Canadian houses, never invents or passes on a postal code
// (OpenStreetMap's are only approximate: the form gets the postal AREA as a hint), a problem at Photon is "type it yourself", and the
// free server is not hammered.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { addressProvider, addressLookupEnabled, photonConfig, photonDailyCap } = require('../src/utils/addressConfig');
const lookup = require('../src/utils/addressLookup');
const { createAddressRouter } = require('../src/routes/address');
const { publicPaymentMethods } = require('../src/utils/paymentMethods');

const fixture = (name) => require(`./fixtures/${name}.json`);
const ON = { ADDRESS_SUGGEST_PHOTON: 'true' };
const fakeFetch = (body, { status = 200 } = {}) => {
  const calls = [];
  const fn = async (url, options) => { calls.push({ url: new URL(url), options }); return { ok: status < 400, status, json: async () => (typeof body === 'function' ? body(new URL(url)) : body) }; };
  fn.calls = calls;
  return fn;
};
const feature = (props) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [-79.38, 43.65] }, properties: { countrycode: 'CA', housenumber: '12', street: 'Elm Street', city: 'Guelph', state: 'Ontario', postcode: 'N1H 4E9', ...props } });

test('the switch: Photon is on only when asked for, Canada Post wins when both are set, and the caps have sane bounds', () => {
  assert.equal(addressProvider({}), null);
  assert.equal(addressLookupEnabled({}), false);
  for (const yes of ['true', 'TRUE', ' 1 ', 'yes', 'on']) assert.equal(addressProvider({ ADDRESS_SUGGEST_PHOTON: yes }), 'photon', yes);
  for (const no of ['', 'false', '0', 'no', 'maybe', 'off']) assert.equal(addressProvider({ ADDRESS_SUGGEST_PHOTON: no }), null, JSON.stringify(no));
  assert.equal(addressLookupEnabled(ON), true);
  assert.equal(addressProvider({ ...ON, ADDRESSCOMPLETE_KEY: 'AB12-CD34-EF56-GH78' }), 'canadapost', 'a valid Canada Post key takes precedence');
  assert.equal(addressProvider({ ...ON, ADDRESSCOMPLETE_KEY: 'not-a-key' }), 'photon', 'a stray key value does not turn the paid provider on');
  assert.equal(photonConfig({}).base, 'https://photon.komoot.io');
  assert.equal(photonConfig({ PHOTON_BASE_URL: 'http://127.0.0.1:5101/photon///' }).base, 'http://127.0.0.1:5101/photon');
  assert.equal(photonDailyCap({}), 3000);
  assert.equal(photonDailyCap({ PHOTON_SEARCHES_PER_DAY: '500' }), 500);
  for (const silly of ['99', '20001', '1.5', 'lots', '-3', '']) assert.equal(photonDailyCap({ PHOTON_SEARCHES_PER_DAY: silly }), 3000, JSON.stringify(silly));
});

test('the public methods answer names the provider, so the page never claims a check the free provider did not make', () => {
  const base = { ETRANSFER_ENABLED: 'true', ETRANSFER_RECIPIENT_EMAIL: 'pay@example.com' };
  const entry = (extra) => publicPaymentMethods({ ...base, ...extra }).find((m) => m.id === 'etransfer');
  assert.deepEqual([entry({}).addressSuggest, entry({}).addressSource], [false, undefined]);
  assert.deepEqual([entry(ON).addressSuggest, entry(ON).addressSource], [true, 'photon']);
  assert.deepEqual([entry({ ADDRESSCOMPLETE_KEY: 'AB12-CD34-EF56-GH78' }).addressSuggest, entry({ ADDRESSCOMPLETE_KEY: 'AB12-CD34-EF56-GH78' }).addressSource], [true, 'canadapost']);
});

test('toPhotonAddress: a real Toronto answer becomes the form\'s address, with the postal AREA as a hint and never a postal code', () => {
  const [first] = fixture('photon-toronto').features;
  assert.deepEqual(lookup.toPhotonAddress(first), { line1: '100 Queen St W', line2: '', city: 'Toronto', state: 'ON', zip: '', zipHint: 'M5H', label: '100 Queen St W, Toronto, ON' });
  for (const f of fixture('photon-toronto').features) assert.equal(lookup.toPhotonAddress(f).zip, '', 'no postal code is ever passed on');
  // French street names and the accented province
  const [montreal] = fixture('photon-montreal').features;
  assert.deepEqual(lookup.toPhotonAddress(montreal), { line1: '275 Rue Notre-Dame Est', line2: '', city: 'Montreal', state: 'QC', zip: '', zipHint: 'H2Y', label: '275 Rue Notre-Dame Est, Montreal, QC' });
  assert.equal(lookup.toPhotonAddress(feature({ state: 'Québec' })).state, 'QC');
  assert.equal(lookup.toPhotonAddress(feature({ state: 'Newfoundland and Labrador' })).state, 'NL');
});

test('toPhotonAddress: only a Canadian street address with a house number gets through', () => {
  assert.ok(lookup.toPhotonAddress(feature({})));
  const rejected = {
    'a United States result': feature({ countrycode: 'US', state: 'Connecticut' }),
    'no country': feature({ countrycode: undefined }),
    'no house number': feature({ housenumber: undefined }),
    'a house number without a digit': feature({ housenumber: 'rear' }),
    'no street': feature({ street: undefined }),
    'no city': feature({ city: undefined }),
    'an unknown province': feature({ state: 'Atlantis' }),
    'no province': feature({ state: undefined }),
  };
  for (const [name, f] of Object.entries(rejected)) assert.equal(lookup.toPhotonAddress(f), null, name);
  assert.equal(lookup.toPhotonAddress(null), null);
  assert.equal(lookup.toPhotonAddress({}), null);
  // a postcode that is not a Canadian one gives no hint (and never an error)
  const odd = lookup.toPhotonAddress(feature({ postcode: '06489' }));
  assert.equal(odd.zipHint, undefined);
  assert.equal(odd.zip, '');
  assert.equal(lookup.toPhotonAddress(feature({ postcode: undefined })).zipHint, undefined);
  // the city falls back to the neighbourhood-level fields OpenStreetMap uses
  assert.equal(lookup.toPhotonAddress(feature({ city: undefined, locality: 'Kleinburg' })).city, 'Kleinburg');
  assert.equal(lookup.toPhotonAddress(feature({ city: undefined, district: 'Scarborough' })).city, 'Scarborough');
});

test('suggest: asks Photon for Canadian houses, with a courteous User-Agent and no key, and hands back what the page needs', async () => {
  const fetchImpl = fakeFetch(fixture('photon-toronto'));
  const out = await lookup.suggest({ query: '100 queen st w toronto' }, { env: ON, fetchImpl });
  assert.equal(out.ok, true);
  assert.equal(fetchImpl.calls.length, 1);
  const { url, options } = fetchImpl.calls[0];
  assert.equal(`${url.origin}${url.pathname}`, 'https://photon.komoot.io/api/');
  assert.equal(url.searchParams.get('q'), '100 queen st w toronto');
  assert.equal(url.searchParams.get('layer'), 'house');
  assert.equal(url.searchParams.get('lang'), 'en');
  assert.equal(url.searchParams.get('bbox'), lookup.CANADA_BBOX);
  assert.match(options.headers['User-Agent'], /^ReflexityRAM-address-suggestions\/1\.0 \(https:\/\/reflexityram\.com; reflexityram@gmail\.com\)$/);
  assert.ok(![...url.searchParams.keys()].some((k) => /key/i.test(k)), 'the free service gets no key of any kind');
  // 5 features, but the same house three times (OpenStreetMap has it as several objects) and "St W" vs "Street West" are ONE suggestion
  assert.deepEqual(out.suggestions.map((s) => [s.text, s.description, s.next]), [['100 Queen St W', 'Toronto, ON', 'retrieve'], ['1001 Queen Street West', 'Toronto, ON', 'retrieve']]);
  for (const s of out.suggestions) assert.match(s.id, /^ph_[A-Za-z0-9_-]{12}$/);
  assert.equal(new Set(out.suggestions.map((s) => s.id)).size, out.suggestions.length);
  assert.ok(out.suggestions.every((s) => lookup.validLookupId(s.id)));
});

test('suggest: United States results are dropped, no more than five come back, and French streets work', async () => {
  const mixed = await lookup.suggest({ query: '100 queen street' }, { env: ON, fetchImpl: fakeFetch(fixture('photon-mixed-countries')) });
  assert.ok(mixed.suggestions.length >= 4 && mixed.suggestions.length <= 5);
  assert.ok(mixed.suggestions.every((s) => /, (ON|QC|BC|AB|MB|SK|NS|NB|NL|PE|NT|NU|YT)$/.test(s.description)), JSON.stringify(mixed.suggestions.map((s) => s.description)));
  assert.ok(!JSON.stringify(mixed).includes('Southington') && !JSON.stringify(mixed).includes('Connecticut'));
  const many = { features: Array.from({ length: 10 }, (_, i) => feature({ housenumber: String(100 + i) })) };
  assert.equal((await lookup.suggest({ query: '10 elm' }, { env: ON, fetchImpl: fakeFetch(many) })).suggestions.length, 5);
  const fr = await lookup.suggest({ query: '275 notre-dame est' }, { env: ON, fetchImpl: fakeFetch(fixture('photon-montreal')) });
  assert.deepEqual(fr.suggestions.map((s) => [s.text, s.description]), [['275 Rue Notre-Dame Est', 'Montreal, QC']]);
});

test('suggest: a short search, or one with no house number yet, never reaches Photon', async () => {
  const fetchImpl = fakeFetch(fixture('photon-toronto'));
  for (const query of ['', '  ', 'ab', '12', 'queen street west', 'main st', undefined, null]) {
    const out = await lookup.suggest({ query }, { env: ON, fetchImpl });
    assert.deepEqual(out, { ok: true, suggestions: [] }, JSON.stringify(query));
  }
  assert.equal(fetchImpl.calls.length, 0, 'nothing was sent');
  // control characters and an enormous string are cleaned and cut before they go out
  await lookup.suggest({ query: `12\u0000 elm\n${'x'.repeat(500)}` }, { env: ON, fetchImpl });
  const sent = fetchImpl.calls[0].url.searchParams.get('q');
  assert.ok(sent.length <= 80 && !/[\u0000-\u001f]/.test(sent), sent);
});

test('suggest: every Photon problem is a soft "unavailable" with a short reason', async () => {
  const q = { query: '100 queen st w' };
  assert.deepEqual(await lookup.suggest(q, { env: ON, fetchImpl: fakeFetch({}, { status: 429 }) }), { ok: false, reason: 'http_429' });
  assert.deepEqual(await lookup.suggest(q, { env: ON, fetchImpl: fakeFetch({}, { status: 503 }) }), { ok: false, reason: 'http_503' });
  assert.deepEqual(await lookup.suggest(q, { env: ON, fetchImpl: fakeFetch({ message: 'nope' }) }), { ok: false, reason: 'shape' });
  assert.deepEqual(await lookup.suggest(q, { env: ON, fetchImpl: fakeFetch(null) }), { ok: false, reason: 'shape' });
  assert.deepEqual(await lookup.suggest(q, { env: ON, fetchImpl: async () => { throw new Error('ECONNRESET to https://photon.komoot.io'); } }), { ok: false, reason: 'network' });
  assert.deepEqual(await lookup.suggest(q, { env: ON, fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } }) }), { ok: false, reason: 'network' });
  const off = fakeFetch(fixture('photon-toronto'));
  assert.deepEqual(await lookup.suggest(q, { env: {}, fetchImpl: off }), { ok: false, reason: 'off' });
  assert.equal(off.calls.length, 0, 'switched off means nothing is sent');
});

test('suggest: a Photon that never answers is cut off after the time allowed', async () => {
  const hang = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const started = Date.now();
  assert.deepEqual(await lookup.suggest({ query: '100 queen st w' }, { env: ON, fetchImpl: hang, timeoutMs: 40 }), { ok: false, reason: 'timeout' });
  assert.ok(Date.now() - started < 1000);
});

test('retrieve: a suggestion finishes the address from what the server remembered, and only for a few minutes', async () => {
  const out = await lookup.suggest({ query: '100 queen st w toronto' }, { env: ON, fetchImpl: fakeFetch(fixture('photon-toronto')) });
  const [{ id }] = out.suggestions;
  const got = lookup.retrievePhoton({ id });
  assert.deepEqual(got, { ok: true, address: { line1: '100 Queen St W', line2: '', city: 'Toronto', state: 'ON', zip: '', zipHint: 'M5H', label: '100 Queen St W, Toronto, ON' } });
  // what comes back is a copy: changing it cannot change what the next buyer gets
  got.address.city = 'Elsewhere';
  assert.equal(lookup.retrievePhoton({ id }).address.city, 'Toronto');
  // the same answer through the dispatcher, with no network call
  const fetchImpl = fakeFetch({});
  assert.equal((await lookup.retrieve({ id }, { env: ON, fetchImpl })).address.line1, '100 Queen St W');
  assert.equal(fetchImpl.calls.length, 0, 'picking costs Photon nothing');
  // unknown, malformed and expired ids
  assert.deepEqual(lookup.retrievePhoton({ id: 'ph_unknownunkn' }), { ok: false, reason: 'expired' });
  assert.deepEqual(lookup.retrievePhoton({ id: 'x' }), { ok: false, reason: 'bad_id' });
  assert.deepEqual(lookup.retrievePhoton({ id: '../../etc' }), { ok: false, reason: 'bad_id' });
  assert.deepEqual(lookup.retrievePhoton({}), { ok: false, reason: 'bad_id' });
  assert.deepEqual(lookup.retrievePhoton({ id }, { now: () => Date.now() + lookup.REMEMBER_MS + 1000 }), { ok: false, reason: 'expired' });
});

const anAddress = (n) => ({ line1: `${n} A St`, line2: '', city: 'X', state: 'ON', zip: '' });

test('the remembered suggestions are bounded: the least recently shown go first, and expired ones are swept', () => {
  const first = lookup.remember(anAddress(0), 1_000);
  for (let i = 1; i <= lookup.REMEMBER_MAX + 20; i += 1) lookup.remember(anAddress(i), 2_000 + i);
  assert.ok(lookup.remembered.size <= lookup.REMEMBER_MAX, `${lookup.remembered.size} remembered`);
  assert.equal(lookup.remembered.has(first), false, 'the oldest was dropped to make room');
  assert.equal(lookup.idByKey.size, lookup.remembered.size, 'the address index never outgrows the entries');
  const before = lookup.remembered.size;
  lookup.remember(anAddress('late'), 2_000 + lookup.REMEMBER_MS + 10_000);
  assert.ok(lookup.remembered.size < before, 'everything older than the time allowed was swept');
  assert.equal(lookup.idByKey.size, lookup.remembered.size);
});

// Review 2026-10-14 (finding 4): with one entry per search result, 100 searches from one visitor pushed out a suggestion another buyer
// had just been shown. Now the same address shares one entry, and showing it again moves it to the back of the line.
test('the same address shares one entry, and showing it again keeps it from being pushed out', () => {
  const now = 50_000_000;
  const mine = lookup.remember(anAddress('mine'), now);
  assert.equal(lookup.remember(anAddress('mine'), now + 1), mine, 'an identical address gets the same id back');
  assert.notEqual(lookup.remember({ ...anAddress('mine'), zipHint: 'M5H' }, now + 2), mine, 'any difference is another entry');
  // another visitor fills almost the whole memory; "mine" is shown again just before the last of it
  for (let i = 0; i < lookup.REMEMBER_MAX - 10; i += 1) lookup.remember(anAddress(`burst-${i}`), now + 10 + i);
  lookup.remember(anAddress('mine'), now + 10 + lookup.REMEMBER_MAX);
  for (let i = 0; i < 20; i += 1) lookup.remember(anAddress(`more-${i}`), now + 20 + lookup.REMEMBER_MAX + i);
  assert.equal(lookup.retrievePhoton({ id: mine }, { now: () => now + 30 + lookup.REMEMBER_MAX }).ok, true, 'still there to be picked');
});

// Review 2026-10-14 (finding 5): a mistyped self-hosted PHOTON_BASE_URL threw out of the soft-failure path (an Express error page).
test('a malformed PHOTON_BASE_URL is a soft "unavailable" (config), never a thrown error', async () => {
  const fetchImpl = fakeFetch({});
  assert.deepEqual(await lookup.suggest({ query: '100 queen st w' }, { env: { ...ON, PHOTON_BASE_URL: 'not a url' }, fetchImpl }), { ok: false, reason: 'config' });
  assert.equal(fetchImpl.calls.length, 0);
});

// Review 2026-10-14 (finding 3): the daily cap on finished addresses counted free picks too, so made-up ids could switch picks off for
// every buyer. The caps now run only for their own provider.
test('onlyWhenProvider runs a limiter only while its provider answers', () => {
  const { onlyWhenProvider } = require('../src/utils/addressConfig');
  const run = (provider, env) => {
    const seen = [];
    onlyWhenProvider(provider, (req, res, next) => { seen.push('limiter'); next(); }, env)({}, {}, () => seen.push('next'));
    return seen;
  };
  assert.deepEqual(run('canadapost', ON), ['next'], 'Photon on: the paid-lookup cap is skipped');
  assert.deepEqual(run('photon', ON), ['limiter', 'next'], 'Photon on: its search cap runs');
  assert.deepEqual(run('canadapost', { ADDRESSCOMPLETE_KEY: 'AB12-CD34-EF56-GH78' }), ['limiter', 'next'], 'Canada Post on: its cap runs');
  assert.deepEqual(run('photon', { ADDRESSCOMPLETE_KEY: 'AB12-CD34-EF56-GH78', ADDRESS_SUGGEST_PHOTON: 'true' }), ['next'], 'a key wins, so the Photon cap is skipped');
  assert.deepEqual(run('photon', {}), ['next'], 'suggestions off: no cap runs');
});

test('the dispatcher: Canada Post when its key is set, Photon when only the flag is, nothing otherwise', async () => {
  const cpFetch = fakeFetch({ Items: [{ Id: 'CAN|1', Text: '100 Queen St W', Description: 'Toronto, ON', Next: 'Retrieve' }] });
  await lookup.suggest({ query: '100 queen' }, { env: { ...ON, ADDRESSCOMPLETE_KEY: 'AB12-CD34-EF56-GH78' }, fetchImpl: cpFetch });
  assert.equal(cpFetch.calls[0].url.host, 'ws1.postescanada-canadapost.ca', 'both set: Canada Post answers');
  const phFetch = fakeFetch(fixture('photon-toronto'));
  await lookup.suggest({ query: '100 queen st w' }, { env: ON, fetchImpl: phFetch });
  assert.equal(phFetch.calls[0].url.host, 'photon.komoot.io');
  const none = fakeFetch({});
  assert.deepEqual(await lookup.suggest({ query: '100 queen st w' }, { env: {}, fetchImpl: none }), { ok: false, reason: 'off' });
  assert.equal(none.calls.length, 0);
});

test('GET /suggest and /retrieve with the free provider: the page\'s shape, never cached, no postal code, and a dead Photon is HTTP 200 "unavailable"', async () => {
  const run = async (deps) => {
    const router = createAddressRouter({ suggest: (a) => lookup.suggest(a, deps), retrieve: (a) => lookup.retrieve(a, deps) });
    const app = express(); app.use('/api/address', router);
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const get = async (path) => { const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`); return { status: res.status, cache: res.headers.get('cache-control'), body: await res.json() }; };
    return { get, close: () => new Promise((r) => server.close(r)) };
  };
  const live = await run({ env: ON, fetchImpl: fakeFetch(fixture('photon-toronto')) });
  try {
    const found = await live.get('/api/address/suggest?q=100%20queen%20st%20w');
    assert.equal(found.status, 200);
    assert.equal(found.cache, 'no-store');
    assert.equal(found.body.suggestions.length, 2);
    const picked = await live.get(`/api/address/retrieve?id=${encodeURIComponent(found.body.suggestions[0].id)}`);
    assert.deepEqual(picked.body.address, { line1: '100 Queen St W', line2: '', city: 'Toronto', state: 'ON', zip: '', zipHint: 'M5H', label: '100 Queen St W, Toronto, ON' });
    assert.deepEqual((await live.get('/api/address/retrieve?id=ph_expiredexpi')).body, { unavailable: true });
    assert.equal((await live.get('/api/address/retrieve?id=!!')).status, 400);
  } finally { await live.close(); }
  const dead = await run({ env: ON, fetchImpl: fakeFetch({}, { status: 503 }) });
  try {
    const down = await dead.get('/api/address/suggest?q=100%20queen%20st%20w');
    assert.equal(down.status, 200);
    assert.deepEqual(down.body, { suggestions: [], unavailable: true });
  } finally { await dead.close(); }
});

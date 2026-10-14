// Address suggestions for the e-Transfer form (Canada Post AddressComplete behind our own API). The provider is always faked here:
// no test reaches Canada Post, spends a lookup, or needs a key. What matters: it is OFF without a key, it never throws, it never
// lets the key out, it only hands back addresses we can ship to, and a provider problem turns into "type it yourself".
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const express = require('express');

const { lookupConfig, addressLookupEnabled, dailyLookupCap } = require('../src/utils/addressConfig');
const { suggest, retrieve, toAddress, cleanQuery, validLookupId } = require('../src/utils/addressLookup');
const { createAddressRouter, reportProblem } = require('../src/routes/address');
const { publicPaymentMethods } = require('../src/utils/paymentMethods');

const KEY = 'AB12-CD34-EF56-GH78';
const env = { ADDRESSCOMPLETE_KEY: KEY };
const reply = (items, status = 200) => ({ ok: status < 400, status, json: async () => ({ Items: items }) });
const fakeFetch = (handler) => { const calls = []; const fn = async (url, options) => { calls.push({ url: new URL(url), options }); return handler(new URL(url), options); }; fn.calls = calls; return fn; };

const TORONTO_ENG = {
  Id: 'CAN|1520704', Language: 'ENG', Company: '', SubBuilding: '', BuildingNumber: '100', Street: 'Queen St W',
  Line1: '100 Queen St W', Line2: '', City: 'Toronto', Province: 'ON', ProvinceName: 'Ontario', PostalCode: 'M5H 2N2',
  CountryName: 'Canada', CountryIso2: 'CA', CountryIso3: 'CAN', Label: '100 Queen St W\nToronto ON  M5H 2N2\nCANADA', DataLevel: 'Premise',
};
const TORONTO_FRE = { ...TORONTO_ENG, Language: 'FRE', Line1: '100 rue Queen O', Street: 'rue Queen O', Label: '100 rue Queen O\nToronto ON  M5H 2N2\nCANADA' };

test('the switch: only a key of the right shape turns it on, and the daily cap has sane bounds', () => {
  assert.equal(addressLookupEnabled({}), false);
  assert.equal(addressLookupEnabled({ ADDRESSCOMPLETE_KEY: '' }), false);
  assert.equal(addressLookupEnabled({ ADDRESSCOMPLETE_KEY: 'true' }), false, 'a stray value does not switch it on');
  assert.equal(addressLookupEnabled({ ADDRESSCOMPLETE_KEY: 'AB12-CD34-EF56' }), false);
  assert.equal(addressLookupEnabled({ ADDRESSCOMPLETE_KEY: 'AB12-CD34-EF56-GH78-JK90' }), false);
  assert.equal(addressLookupEnabled(env), true);
  assert.equal(addressLookupEnabled({ ADDRESSCOMPLETE_KEY: ` ${KEY.toLowerCase()} ` }), true, 'case and spaces are forgiven');
  assert.equal(lookupConfig(env).base, 'https://ws1.postescanada-canadapost.ca/AddressComplete/Interactive');
  assert.equal(lookupConfig({ ...env, ADDRESSCOMPLETE_BASE_URL: 'http://127.0.0.1:5101/ac///' }).base, 'http://127.0.0.1:5101/ac');
  assert.equal(dailyLookupCap({}), 100);
  assert.equal(dailyLookupCap({ ADDRESS_LOOKUPS_PER_DAY: '250' }), 250);
  for (const silly of ['9', '2001', '1.5', 'many', '-4', '']) assert.equal(dailyLookupCap({ ADDRESS_LOOKUPS_PER_DAY: silly }), 100, `cap ${JSON.stringify(silly)}`);
});

test('the public methods answer says whether the e-Transfer form may offer suggestions, and only for e-Transfer', () => {
  const on = { ETRANSFER_ENABLED: 'true', ETRANSFER_RECIPIENT_EMAIL: 'pay@example.com' };
  assert.equal(publicPaymentMethods(on).find((m) => m.id === 'etransfer').addressSuggest, false);
  assert.equal(publicPaymentMethods({ ...on, ...env }).find((m) => m.id === 'etransfer').addressSuggest, true);
  assert.ok(!JSON.stringify(publicPaymentMethods({ ...on, ...env })).includes(KEY), 'the key never appears in the public answer');
  assert.equal('addressSuggest' in publicPaymentMethods({ ...on, ...env }).find((m) => m.id === 'card'), false);
});

test('suggest: asks Canada Post for Canadian addresses only, with the key, and hands back what the page needs', async () => {
  const fetchImpl = fakeFetch(() => reply([
    { Id: 'CAN|PR|X1|E|0|0', Text: '100 Queen St W', Highlight: '0-3', Cursor: 0, Description: 'Toronto, ON, M5H 2N2', Next: 'Retrieve' },
    { Id: 'CAN|ST|X2|E|0|0', Text: '100 Queen St W', Description: 'Toronto, ON - 12 Addresses', Next: 'Find' },
    { Id: 'CAN|PR|X3', Text: '100 Queen St E', Description: 'Brampton, ON, L6V 1A1', Next: 'Retrieve' },
  ]));
  const out = await suggest({ query: '  100   que ' }, { env, fetchImpl });
  assert.equal(out.ok, true);
  assert.deepEqual(out.suggestions.map((s) => [s.id, s.text, s.description, s.next]), [
    ['CAN|PR|X1|E|0|0', '100 Queen St W', 'Toronto, ON, M5H 2N2', 'retrieve'],
    ['CAN|ST|X2|E|0|0', '100 Queen St W', 'Toronto, ON - 12 Addresses', 'find'],
    ['CAN|PR|X3', '100 Queen St E', 'Brampton, ON, L6V 1A1', 'retrieve'],
  ]);
  const { url, options } = fetchImpl.calls[0];
  assert.equal(`${url.origin}${url.pathname}`, 'https://ws1.postescanada-canadapost.ca/AddressComplete/Interactive/Find/v2.10/json3.ws');
  assert.equal(url.searchParams.get('Key'), KEY);
  assert.equal(url.searchParams.get('SearchTerm'), '100 que', 'spaces are tidied');
  assert.equal(url.searchParams.get('Country'), 'CAN');
  assert.equal(url.searchParams.get('LanguagePreference'), 'en');
  assert.equal(url.searchParams.get('MaxSuggestions'), '7');
  assert.equal(url.searchParams.has('LastId'), false);
  assert.ok(options.signal, 'it can be cut off');
});

test('suggest: picking a building continues INSIDE it (LastId) and a short, odd or unsafe search never reaches the provider', async () => {
  const fetchImpl = fakeFetch(() => reply([]));
  await suggest({ query: '100 queen', lastId: 'CAN|ST|X2|E|0|0' }, { env, fetchImpl });
  assert.equal(fetchImpl.calls[0].url.searchParams.get('LastId'), 'CAN|ST|X2|E|0|0');
  const noCalls = fakeFetch(() => reply([]));
  for (const short of ['', ' ', 'ab', '  a ', undefined, null]) assert.deepEqual(await suggest({ query: short }, { env, fetchImpl: noCalls }), { ok: true, suggestions: [] }, JSON.stringify(short));
  assert.equal(noCalls.calls.length, 0, 'under three characters nothing is asked');
  for (const bad of ['has space', 'a|b|c|d|e|f|g|h|i|j|k|l|m|n|o|p|q|r|s|t|u|v|w|x|y|z|1|2|3|4|5|6|7|8|9|0|1|2|3|4|5|6|7|8|9', '../etc', 'x&Key=1']) {
    assert.deepEqual(await suggest({ query: 'queen st', lastId: bad }, { env, fetchImpl: noCalls }), { ok: false, reason: 'bad_id' }, bad);
  }
  assert.equal(noCalls.calls.length, 0);
  assert.equal(cleanQuery('a\u0000b\tc\n d'), 'a b c d');
  assert.equal(cleanQuery('x'.repeat(200)).length, 80);
  assert.equal(validLookupId('CAN|PR|X247361852|E|0|0'), true);
  assert.equal(validLookupId('CAN|1520704'), true);
  assert.equal(validLookupId('bad id'), false);
  assert.equal(validLookupId(undefined), false);
});

test('suggest: items without a usable id or text are dropped, and no more than seven come back', async () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ Id: `CAN|PR|${i}`, Text: `${i} Main St`, Description: 'Barrie, ON', Next: 'Retrieve' }));
  const out = await suggest({ query: 'main st' }, { env, fetchImpl: fakeFetch(() => reply([{ Id: '', Text: 'no id' }, { Id: 'CAN|1', Text: '' }, null, 'junk', ...many])) });
  assert.equal(out.suggestions.length, 7);
  assert.equal(out.suggestions[0].id, 'CAN|PR|0');
});

test('every failure is a soft "unavailable" with a short reason, and the key never leaks into one', async () => {
  const cases = [
    ['no key', {}, () => reply([]), 'off'],
    ['unknown key', env, () => reply([{ Error: '2', Description: 'Unknown key', Cause: `The key ${KEY} was not found`, Resolution: 'Check it' }]), 'provider_2'],
    ['out of credit', env, () => reply([{ Error: '3', Description: 'Account out of credit' }]), 'provider_3'],
    ['daily limit', env, () => reply([{ Error: '8', Description: 'Key daily limit exceeded' }]), 'provider_8'],
    ['http error', env, () => reply([], 503), 'http_503'],
    ['not json', env, () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } }), 'network'],
    ['wrong shape', env, () => ({ ok: true, status: 200, json: async () => ({ nothing: true }) }), 'shape'],
    ['network down', env, () => { throw new TypeError(`fetch failed for https://x/?Key=${KEY}`); }, 'network'],
  ];
  for (const [name, settings, handler, reason] of cases) {
    const out = await suggest({ query: 'queen st' }, { env: settings, fetchImpl: fakeFetch(handler) });
    assert.deepEqual(out, { ok: false, reason }, name);
    assert.ok(!JSON.stringify(out).includes(KEY), `${name}: the key stays out of the answer`);
  }
});

test('a provider that never answers is cut off after the time allowed', async () => {
  const hang = (url, options) => new Promise((resolve, reject) => { options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); });
  const started = Date.now();
  const out = await suggest({ query: 'queen st' }, { env, fetchImpl: hang, timeoutMs: 30 });
  assert.deepEqual(out, { ok: false, reason: 'timeout' });
  assert.ok(Date.now() - started < 1000);
});

test('retrieve: the English row becomes the form\'s address, and the key and id go to the right service', async () => {
  const fetchImpl = fakeFetch(() => reply([TORONTO_FRE, TORONTO_ENG]));
  const out = await retrieve({ id: 'CAN|1520704' }, { env, fetchImpl });
  assert.deepEqual(out, { ok: true, address: { line1: '100 Queen St W', line2: '', city: 'Toronto', state: 'ON', zip: 'M5H 2N2', label: '100 Queen St W, Toronto ON M5H 2N2, CANADA' } });
  const { url } = fetchImpl.calls[0];
  assert.equal(`${url.origin}${url.pathname}`, 'https://ws1.postescanada-canadapost.ca/AddressComplete/Interactive/Retrieve/v2.11/json3.ws');
  assert.equal(url.searchParams.get('Id'), 'CAN|1520704');
  assert.equal(url.searchParams.get('Key'), KEY);
});

test('retrieve: only an address we can ship to comes back (Canada, a province, a real postal code, a street and a city)', () => {
  assert.deepEqual(toAddress([{ ...TORONTO_ENG, Line1: '', BuildingNumber: '100', Street: 'Queen St W', PostalCode: 'm5h2n2', Line2: 'Unit 5' }]),
    { line1: '100 Queen St W', line2: 'Unit 5', city: 'Toronto', state: 'ON', zip: 'M5H 2N2', label: '100 Queen St W, Toronto ON M5H 2N2, CANADA' }, 'the street is built from the parts, the postal code is tidied');
  assert.equal(toAddress([{ ...TORONTO_ENG, CountryIso2: 'US', CountryIso3: 'USA' }]), null, 'not Canada');
  assert.equal(toAddress([{ ...TORONTO_ENG, Province: 'ZZ' }]), null, 'not a province');
  assert.equal(toAddress([{ ...TORONTO_ENG, PostalCode: 'D0D 0D0' }]), null, 'not a postal code');
  assert.equal(toAddress([{ ...TORONTO_ENG, PostalCode: '' }]), null, 'a street or a city on its own is not an address');
  assert.equal(toAddress([{ ...TORONTO_ENG, Line1: '', BuildingNumber: '', Street: '' }]), null, 'no street');
  assert.equal(toAddress([{ ...TORONTO_ENG, City: '' }]), null, 'no city');
  assert.equal(toAddress([]), null);
  assert.equal(toAddress(undefined), null);
  assert.equal(toAddress([null, 'x']), null);
  assert.deepEqual(toAddress([{ ...TORONTO_ENG, Province: 'QC', ProvinceCode: undefined, Line1: ' 3333  Boul de la Côte-Vertu ', City: 'Montréal', PostalCode: 'H4R1Y8' }]).zip, 'H4R 1Y8');
  assert.equal(toAddress([{ ...TORONTO_ENG, Line1: 'x'.repeat(300) }]).line1.length, 120, 'long lines are cut to what the order accepts');
});

test('retrieve: a bad id is refused without asking, and an unfinished address is "incomplete"', async () => {
  const fetchImpl = fakeFetch(() => reply([{ ...TORONTO_ENG, PostalCode: '', DataLevel: 'Street' }]));
  assert.deepEqual(await retrieve({ id: 'x y' }, { env, fetchImpl }), { ok: false, reason: 'bad_id' });
  assert.deepEqual(await retrieve({}, { env, fetchImpl }), { ok: false, reason: 'bad_id' });
  assert.equal(fetchImpl.calls.length, 0);
  assert.deepEqual(await retrieve({ id: 'CAN|ST|X2' }, { env, fetchImpl }), { ok: false, reason: 'incomplete' });
  assert.deepEqual(await retrieve({ id: 'CAN|ST|X2' }, { env: {}, fetchImpl }), { ok: false, reason: 'off' });
});

// ── the HTTP routes ───────────────────────────────────────────────────────────────────────────────────────────────────
async function call(router, path) {
  const app = express();
  app.use('/api/address', router);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/address${path}`);
    return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json().catch(() => null) };
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('GET /suggest and /retrieve answer in the page\'s shape, never cached, and a provider problem is HTTP 200 "unavailable"', async () => {
  const asked = [];
  const router = createAddressRouter({
    suggest: async (input) => { asked.push(['suggest', input]); return { ok: true, suggestions: [{ id: 'CAN|1', text: '100 Queen St W', description: 'Toronto, ON', next: 'retrieve' }] }; },
    retrieve: async (input) => { asked.push(['retrieve', input]); return { ok: true, address: { line1: '100 Queen St W', line2: '', city: 'Toronto', state: 'ON', zip: 'M5H 2N2', label: '' } }; },
  });
  const found = await call(router, '/suggest?q=100%20que');
  assert.equal(found.status, 200);
  assert.equal(found.cache, 'no-store');
  assert.equal(found.body.suggestions[0].text, '100 Queen St W');
  assert.deepEqual(asked[0], ['suggest', { query: '100 que', lastId: undefined }]);
  await call(router, '/suggest?q=100%20que&lastId=CAN%7CST%7CX2');
  assert.equal(asked[1][1].lastId, 'CAN|ST|X2');
  const picked = await call(router, '/retrieve?id=CAN%7C1520704');
  assert.equal(picked.status, 200);
  assert.equal(picked.body.address.zip, 'M5H 2N2');
  assert.deepEqual(asked[2], ['retrieve', { id: 'CAN|1520704' }]);

  const broken = createAddressRouter({ suggest: async () => ({ ok: false, reason: 'provider_3' }), retrieve: async () => ({ ok: false, reason: 'timeout' }) });
  assert.deepEqual((await call(broken, '/suggest?q=queen')).body, { suggestions: [], unavailable: true });
  assert.deepEqual((await call(broken, '/retrieve?id=CAN%7C1')).body, { unavailable: true });
  const refused = createAddressRouter({ suggest: async () => ({ ok: false, reason: 'bad_id' }), retrieve: async () => ({ ok: false, reason: 'bad_id' }) });
  assert.equal((await call(refused, '/suggest?q=queen&lastId=zz')).status, 400);
  assert.equal((await call(refused, '/retrieve?id=zz%20zz')).status, 400);
  assert.ok([400, 422].includes((await call(broken, '/retrieve')).status), 'a missing id is refused');
  assert.ok([400, 422].includes((await call(broken, '/suggest')).status), 'a missing search is refused');
});

test('a provider problem is logged once an hour per reason, as a reason code only', () => {
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.join(' '));
  try {
    const t0 = Date.now() + 10 * 3600 * 1000;
    reportProblem('provider_3', t0); reportProblem('provider_3', t0 + 1000); reportProblem('provider_3', t0 + 59 * 60 * 1000);
    reportProblem('provider_8', t0 + 2000);
    reportProblem('provider_3', t0 + 61 * 60 * 1000);
    reportProblem('off', t0); reportProblem('bad_id', t0); reportProblem('incomplete', t0);
  } finally { console.error = original; }
  assert.equal(lines.length, 3, 'provider_3 twice (an hour apart), provider_8 once, the quiet reasons never');
  assert.ok(lines.every((line) => /\(provider_\d\)/.test(line) && !/Key|key=/.test(line)));
});

test('server: the address routes are mounted before the site-wide limiter, each with its own limit, and the paid pick has a daily cap', () => {
  const source = fs.readFileSync(require.resolve('../src/server.js'), 'utf8');
  const suggestLimiter = source.indexOf("app.use('/api/address/suggest', addressSuggestLimiter, onlyForPhoton(photonSearchDayLimiter));");
  const pickLimiter = source.indexOf("app.use('/api/address/retrieve', addressPickLimiter, addressDayLimiter);");
  const router = source.indexOf("app.use('/api/address', createAddressRouter());");
  const global = source.indexOf('app.use(globalLimiter);');
  assert.ok(suggestLimiter > 0 && pickLimiter > 0 && router > 0 && global > 0);
  assert.ok(suggestLimiter < router && pickLimiter < router, 'limits run before the router');
  assert.ok(router < global, 'typing an address does not use up the buyer\'s site-wide budget');
  assert.match(source, /const addressPickLimiter = rateLimit\(\{[\s\S]*?windowMs: 60 \* 60 \* 1000,\s*max: 20,/, 'twenty finished addresses an hour per connection');
  assert.match(source, /const addressDayLimiter = rateLimit\(\{[\s\S]*?max: dailyLookupCap\(\),\s*keyGenerator: \(\) => 'everyone',/, 'one daily cap for the whole site');
  assert.match(source, /const addressSuggestLimiter = rateLimit\(\{[\s\S]*?windowMs: 5 \* 60 \* 1000,\s*max: 150,/);
  // a limiter whose store is down must refuse, not wave everything through: the daily one is what protects the paid credit
  for (const name of ['addressSuggestLimiter', 'addressPickLimiter', 'addressDayLimiter']) {
    const block = source.slice(source.indexOf(`const ${name} = rateLimit({`)).split('\n});')[0];
    assert.match(block, /passOnStoreError: false/, `${name} fails closed`);
    assert.doesNotMatch(block, /passOnStoreError: true/, `${name} never fails open`);
    assert.match(block, /new MongoRateLimitStore\(\{ prefix: 'addr[a-z]+' \}\)/, `${name} counts in the shared store (not per process)`);
  }
  // the free provider's own daily cap (searches for the whole site) is shared, fails closed, and only counts while Photon is the provider
  const photonBlock = source.slice(source.indexOf('const photonSearchDayLimiter = rateLimit({')).split('\n});')[0];
  assert.match(photonBlock, /max: photonDailyCap\(\),\s*keyGenerator: \(\) => 'everyone',/);
  assert.match(photonBlock, /passOnStoreError: false/);
  assert.match(photonBlock, /new MongoRateLimitStore\(\{ prefix: 'photonday' \}\)/);
  assert.match(source, /const onlyForPhoton = \(limiter\) => \(req, res, next\) => \(addressProvider\(\) === 'photon' \? limiter\(req, res, next\) : next\(\)\);/);
});

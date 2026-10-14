// Address suggestions on the e-Transfer form (owner's ask, 2026-10-13). The box itself is proved in a real browser
// (walk-address-suggest.cjs and walk-review-followups.cjs against a stand-in for Canada Post, kept in the owner's project notes, NOT in
// this repository: docs/testing-notes.md); these are its rules and the way it is wired in. The component's inner behaviour (that a list
// opens, that a pick fills the form) is only proved by those browser walks: the unit tests here cannot see it.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DEBOUNCE_MS, MIN_CHARS, QUIET_AFTER_PROBLEM_MS, applyAddress, dropsOnDismiss, nextActive, postalNotes, provinceToSelect, provincesForPostalCode, resultsAnnouncement, sourceNote, OSM_COPYRIGHT_URL, pickFailedNote, worthSearching } from '../src/lib/addressSuggest.js';
import { ETRANSFER, offeredMethods } from '../src/lib/paymentMethods.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('a search needs three characters, waits for a pause, and stays quiet for a minute after a problem', () => {
  assert.equal(MIN_CHARS, 3);
  assert.equal(worthSearching('10'), false);
  assert.equal(worthSearching('  10 '), false, 'spaces do not count');
  assert.equal(worthSearching('100'), true);
  assert.equal(worthSearching(undefined), false);
  assert.ok(DEBOUNCE_MS >= 200 && DEBOUNCE_MS <= 400, 'a pause, not a request per key');
  assert.equal(QUIET_AFTER_PROBLEM_MS, 60_000);
});

test('the highlighted suggestion moves with Down and Up, wraps around, and is none when there is nothing to choose', () => {
  assert.equal(nextActive(-1, 'ArrowDown', 3), 0);
  assert.equal(nextActive(0, 'ArrowDown', 3), 1);
  assert.equal(nextActive(2, 'ArrowDown', 3), 0, 'past the last goes to the first');
  assert.equal(nextActive(-1, 'ArrowUp', 3), 2, 'Up from nothing goes to the last');
  assert.equal(nextActive(0, 'ArrowUp', 3), 2);
  assert.equal(nextActive(2, 'ArrowUp', 3), 1);
  assert.equal(nextActive(1, 'a', 3), 1, 'another key changes nothing');
  for (const count of [0, -1, NaN, undefined]) assert.equal(nextActive(0, 'ArrowDown', count), -1);
});

test('leaving the field drops a search that is still on its way, and never a pick', () => {
  assert.equal(dropsOnDismiss('find'), true, 'a slow search must not reopen the list over the next field');
  assert.equal(dropsOnDismiss('pick'), false, 'the address the buyer just chose must still arrive');
  assert.equal(dropsOnDismiss(null), false);
  assert.equal(dropsOnDismiss(undefined), false);
});

test('a picked address fills the address fields and keeps the buyer\'s own apartment only when it brings none', () => {
  const form = { firstName: 'Sam', email: 's@example.com', line1: '100 que', line2: 'Apt 9', city: '', state: 'ON', zip: '' };
  const toronto = { line1: '100 Queen St W', line2: '', city: 'Toronto', state: 'ON', zip: 'M5H 2N2' };
  assert.deepEqual(applyAddress(form, toronto), { ...form, line1: '100 Queen St W', line2: 'Apt 9', city: 'Toronto', state: 'ON', zip: 'M5H 2N2' });
  assert.equal(applyAddress(form, { ...toronto, line2: 'Unit 5' }).line2, 'Unit 5', 'the address\'s own unit wins');
  assert.equal(applyAddress(form, { ...toronto, state: 'QC', city: 'Montréal', zip: 'H4R 1Y8' }).state, 'QC');
  assert.equal(applyAddress(form, toronto).firstName, 'Sam', 'nothing else on the form is touched');
  assert.equal(form.line1, '100 que', 'the old form is left alone');
  assert.match(resultsAnnouncement(0), /No suggestions/);
  assert.match(resultsAnnouncement(1), /^1 suggestion available/);
  assert.match(resultsAnnouncement(5), /^5 suggestions available/);
});

test('the server\'s "suggestions are on" flag reaches only the e-Transfer entry, and only when exactly true', () => {
  const listed = (flag) => offeredMethods([{ id: 'etransfer', discountPct: 2, addressSuggest: flag }]).find((m) => m.id === ETRANSFER);
  assert.equal(listed(true).addressSuggest, true);
  for (const silly of [false, undefined, 'true', 1, null]) assert.equal('addressSuggest' in listed(silly), false, JSON.stringify(silly));
  assert.equal('addressSuggest' in offeredMethods([{ id: 'bank_debit', discountPct: 1, addressSuggest: true }]).find((m) => m.id === 'bank_debit'), false);
});

test('the box is an accessible combobox, only opens a list for real results, and only a finished address costs a lookup', async () => {
  const box = await read('../src/components/AddressSuggest.jsx');
  for (const attribute of ["role: 'combobox'", "'aria-expanded': showList", "'aria-controls': listId", "'aria-autocomplete': 'list'", "'aria-activedescendant'"]) assert.ok(box.includes(attribute), attribute);
  assert.match(box, /role="listbox"/);
  assert.match(box, /role="option"/);
  assert.match(box, /aria-selected=\{index === active\}/);
  assert.match(box, /role="status" aria-live="polite"/, 'the number of suggestions is announced');
  assert.match(box, /onMouseDown=\{\(event\) => event\.preventDefault\(\)\}/, 'a tap on a suggestion does not blur the field first');
  assert.match(box, /const showList = enabled && open && items\.length > 0;/);
  // keys
  for (const key of ["'ArrowDown'", "'ArrowUp'", "'Enter'", "'Escape'", "'Tab'"]) assert.ok(box.includes(key), key);
  assert.match(box, /else if \(event\.key === 'Enter' && active >= 0\) \{ event\.preventDefault\(\); pick\(items\[active\]\); \}/, 'Enter picks, and does not submit the form');
  // a building is opened, a finished address is looked up exactly once
  assert.match(box, /if \(suggestion\.next !== 'retrieve'\) \{[\s\S]*?search\(typed\.current \|\| suggestion\.text, suggestion\.id\);[\s\S]*?return;\s*\}/);
  assert.match(box, /addressApi\.retrieve\(suggestion\.id, controller\.current\.signal\)/);
  assert.equal((box.match(/addressApi\.retrieve\(/g) || []).length, 1, 'one place spends a lookup');
  // soft failure
  assert.match(box, /if \(data\?\.unavailable\) \{ quietUntil\.current = Date\.now\(\) \+ QUIET_AFTER_PROBLEM_MS;/);
  // A failed pick says so (the words depend on the provider: pickFailedNote, tested below).
  assert.match(box, /setNote\(pickFailedNote\(source\)\)/);
  assert.match(box, /\+ DEBOUNCE_MS|, DEBOUNCE_MS\)/);
  assert.match(box, /await addressApi\.suggest\(text, lastId, controller\.current\.signal\);\s*if \(request !== latest\.current\) return;/, 'a late list never overwrites a newer search');
  assert.match(box, /await addressApi\.retrieve\(suggestion\.id, controller\.current\.signal\);\s*if \(request !== latest\.current\) return;/, 'a late pick never overwrites a newer one');
  assert.match(box, /\{\.\.\.inputProps\}/, 'the page keeps its own test ids and autocomplete');
  assert.match(box, /const dismiss = \(\) => \{\s*if \(dropsOnDismiss\(inflight\.current\)\) \{ latest\.current \+= 1; controller\.current\?\.abort\(\); inflight\.current = null; setBusy\(false\); \}\s*close\(\);\s*\};/);
  assert.match(box, /onBlur=\{\(\) => window\.setTimeout\(dismiss, 150\)\}/, 'a tap elsewhere');
  assert.match(box, /event\.key === 'Escape'[^\n]*dismiss\(\)[\s\S]*?event\.key === 'Tab'[^\n]*dismiss\(\)|\(event\.key === 'Escape' \|\| event\.key === 'Tab'\) dismiss\(\)/, 'Escape and Tab');
  assert.match(box, /inflight\.current = 'find';/);
  assert.match(box, /inflight\.current = 'pick';/);
});

test('the e-Transfer page uses the box only when the server says so, marks "checked" only after a pick, and removes the mark on any edit', async () => {
  const page = await read('../src/pages/CheckoutEtransfer.jsx');
  assert.match(page, /enabled=\{Boolean\(offer\?\.addressSuggest\)\}/);
  assert.match(page, /verified=\{checked\}/);
  assert.match(page, /const ADDRESS_FIELDS = \['line1', 'line2', 'city', 'state', 'zip'\];/);
  assert.match(page, /if \(ADDRESS_FIELDS\.includes\(name\) && !\(name === 'zip' && freeSuggestions\)\) \{ setChecked\(false\); setZipHint\(''\); \}/);
  assert.match(page, /const pickAddress = \(address\) => \{[\s\S]*?setForm\(\(f\) => applyAddress\(f, address\)\);[\s\S]*?setChecked\(true\);/);
  assert.match(page, /inputProps=\{\{ autoComplete: 'address-line1', 'data-testid': 'et-line1' \}\}/, 'browser autofill and the test id are kept');
  const api = await read('../src/lib/api.js');
  assert.match(api, /suggest: \(q, lastId, signal\) => publicApi\.get\('\/address\/suggest'/);
  assert.match(api, /retrieve: \(id, signal\) => publicApi\.get\('\/address\/retrieve'/);
});

test('the Privacy page says where the typed address goes', async () => {
  const privacy = await read('../src/pages/policies/Privacy.jsx');
  assert.match(privacy, /heading: "Address suggestions"/);
  assert.match(privacy, /sent through our server to an address search service that suggests Canadian addresses: either Canada Post's AddressComplete service, or Photon, a free open-source service run by Komoot on OpenStreetMap data/);
  assert.match(privacy, /Only the text you typed is sent \(never your name, email or connection address\)/);
  assert.match(privacy, /we do not keep those searches/);
  assert.match(privacy, /Canada Post's AddressComplete or Photon \(Komoot, on OpenStreetMap data\) — suggest addresses as you type on the Interac e-Transfer page, when suggestions are on\. They receive only the text you typed\./);
  assert.match(privacy, /Last updated: October 14, 2026\./);
  assert.match(privacy, /You can ignore the suggestions and type your address yourself\./);
});

// ── The free provider (Photon / OpenStreetMap), 2026-10-14 ─────────────────────────────────────────────────────────────────────────
test('the free provider only suggests houses, so the box waits for a number; Canada Post\'s waits for three characters as before', () => {
  assert.equal(worthSearching('queen street west', 'photon'), false);
  assert.equal(worthSearching('12', 'photon'), false, 'two characters never search');
  assert.equal(worthSearching('12 e', 'photon'), true);
  assert.equal(worthSearching('100 queen', 'photon'), true);
  assert.equal(worthSearching('queen street west', 'canadapost'), true);
  assert.equal(worthSearching('queen street west'), true, 'the default is the paid provider');
  assert.match(sourceNote('photon'), /OpenStreetMap/);
  assert.doesNotMatch(sourceNote('photon'), /Canada Post/);
  assert.match(sourceNote('canadapost'), /Canada Post/);
  assert.equal(sourceNote(undefined), sourceNote('canadapost'));
});

test('a suggestion with no postal code leaves the one the buyer already typed, and one with a postal code still replaces it', () => {
  const form = { line1: '100 que', line2: '', city: '', state: 'ON', zip: 'M5H 2N2' };
  const free = { line1: '100 Queen St W', line2: '', city: 'Toronto', state: 'ON', zip: '', zipHint: 'M5H' };
  assert.equal(applyAddress(form, free).zip, 'M5H 2N2');
  assert.equal(applyAddress({ ...form, zip: '' }, free).zip, '');
  assert.equal(applyAddress(form, { ...free, zip: 'M5H 2N1' }).zip, 'M5H 2N1', 'a postal code from Canada Post is authoritative');
});

test('the first letter of a postal code names the province, and X is shared by the two territories', () => {
  const expected = { A: 'NL', B: 'NS', C: 'PE', E: 'NB', G: 'QC', H: 'QC', J: 'QC', K: 'ON', L: 'ON', M: 'ON', N: 'ON', P: 'ON', R: 'MB', S: 'SK', T: 'AB', V: 'BC', Y: 'YT' };
  for (const [letter, province] of Object.entries(expected)) assert.deepEqual(provincesForPostalCode(`${letter}1A 1A1`), [province], letter);
  assert.deepEqual(provincesForPostalCode('X0A 0H0'), ['NT', 'NU']);
  for (const none of ['', 'D1A 1A1', 'W1A 1A1', 'Z1A 1A1', 'O1A 1A1', '1A1', undefined, null]) assert.deepEqual(provincesForPostalCode(none), [], JSON.stringify(none));
  assert.deepEqual(provincesForPostalCode(' m5h 2n2 '), ['ON'], 'case and spaces are forgiven');
});

test('a complete postal code selects its province unless the buyer chose one, and never guesses between two', () => {
  assert.equal(provinceToSelect('T2G 2M3'), 'AB');
  assert.equal(provinceToSelect('t2g2m3'), 'AB');
  assert.equal(provinceToSelect('V6B 6B1', { touched: false }), 'BC');
  assert.equal(provinceToSelect('V6B 6B1', { touched: true }), '', 'a province the buyer (or a suggestion) chose stays');
  assert.equal(provinceToSelect('V6B'), '', 'a partly typed code changes nothing');
  assert.equal(provinceToSelect('V6B 6B'), '');
  assert.equal(provinceToSelect('X0A 0H0'), '', 'two territories share X: no guess');
  assert.equal(provinceToSelect('D1A 1A1'), '');
  assert.equal(provinceToSelect(''), '');
});

test('the postal code notes point at a likely slip and say nothing while the code is still being typed', () => {
  const kinds = (args) => postalNotes(args).map((n) => n.kind);
  // province: only judged once the code is complete
  assert.deepEqual(kinds({ zip: 'T2G 2M3', state: 'ON' }), ['province']);
  assert.deepEqual(postalNotes({ zip: 'T2G 2M3', state: 'ON' })[0], { kind: 'province', provinces: ['AB'], state: 'ON' });
  assert.deepEqual(kinds({ zip: 'T2G 2M3', state: 'AB' }), []);
  assert.deepEqual(kinds({ zip: 'T2G', state: 'ON' }), [], 'not complete yet');
  assert.deepEqual(kinds({ zip: 'X0A 0H0', state: 'NU' }), []);
  assert.deepEqual(kinds({ zip: 'X0A 0H0', state: 'ON' }), ['province']);
  assert.deepEqual(kinds({ zip: '', state: 'ON' }), []);
  // postal area: against the suggested street's area (first three characters), from three characters on
  assert.deepEqual(kinds({ zip: 'M5H 2N2', state: 'ON', hint: 'M5H' }), ['area-same']);
  assert.deepEqual(kinds({ zip: 'm5h', state: 'ON', hint: 'M5H' }), ['area-same']);
  assert.deepEqual(kinds({ zip: 'M6J 1A1', state: 'ON', hint: 'M5H' }), ['area-differs']);
  assert.deepEqual(postalNotes({ zip: 'M6J 1A1', state: 'ON', hint: 'M5H' })[0], { kind: 'area-differs', area: 'M5H', typed: 'M6J' });
  assert.deepEqual(kinds({ zip: 'M5', state: 'ON', hint: 'M5H' }), [], 'fewer than three characters say nothing');
  assert.deepEqual(kinds({ zip: 'M5H 2N2', state: 'ON', hint: '' }), [], 'no hint, no comparison');
  assert.deepEqual(kinds({ zip: 'M5H 2N2', state: 'ON', hint: 'M5' }), [], 'a hint that is not three characters is ignored');
  // both at once
  assert.deepEqual(kinds({ zip: 'T2G 2M3', state: 'ON', hint: 'M5H' }), ['province', 'area-differs']);
});

test('the server\'s provider name reaches the page: "photon" only when the server says so, otherwise Canada Post', () => {
  const listed = (entry) => offeredMethods([{ id: 'etransfer', discountPct: 2, ...entry }]).find((m) => m.id === ETRANSFER);
  assert.equal(listed({ addressSuggest: true, addressSource: 'photon' }).addressSource, 'photon');
  assert.equal(listed({ addressSuggest: true, addressSource: 'canadapost' }).addressSource, 'canadapost');
  assert.equal(listed({ addressSuggest: true }).addressSource, 'canadapost', 'an older server that does not say is the paid provider');
  assert.equal(listed({ addressSuggest: true, addressSource: 'something else' }).addressSource, 'canadapost');
  assert.equal('addressSource' in listed({ addressSuggest: false, addressSource: 'photon' }), false, 'suggestions off: no source');
});

test('the e-Transfer page words its notes by the provider, never claims a check the free one did not make, and selects the province from the postal code', async () => {
  const page = await read('../src/pages/CheckoutEtransfer.jsx');
  assert.match(page, /source=\{offer\?\.addressSource\}/);
  assert.match(page, /const freeSuggestions = offer\?\.addressSource === 'photon';/);
  assert.match(page, /if \(name === 'zip'\) \{ const province = provinceToSelect\(value, \{ touched: stateTouched\.current \}\); if \(province\) next\.state = province; \}/);
  assert.match(page, /if \(name === 'state'\) stateTouched\.current = true;/);
  assert.match(page, /setZipHint\(address\.zipHint \|\| ''\);\s*stateTouched\.current = true;/, 'a picked province counts as chosen');
  assert.match(page, /const notes = postalNotes\(\{ zip: form\.zip, state: form\.state, hint: zipHint \}\);/);
  assert.match(page, /data-testid="et-postal-notes"/);
  const box = await read('../src/components/AddressSuggest.jsx');
  assert.match(box, /verified && !error && source === 'photon'[\s\S]*?data-testid="address-suggested"[\s\S]*?filled in from <a href=\{OSM_COPYRIGHT_URL\}[^>]*>OpenStreetMap<\/a>/);
  assert.match(box, /verified && !error && source !== 'photon'[\s\S]*?data-testid="address-verified"[\s\S]*?checked against Canada Post/);
  const photonBlock = box.slice(box.indexOf("source === 'photon' && ("), box.indexOf("source !== 'photon' && ("));
  assert.doesNotMatch(photonBlock, /checked against/i, 'the free provider\'s note never says "checked"');
});

// OpenStreetMap's licence: the credit sits under the list without a click, links to the copyright page, and a press on it does not
// close the list (the field keeps focus, as with the options), so the link can actually be followed.
test("the free provider's suggestions carry a linked OpenStreetMap credit that a press does not close", async () => {
  assert.equal(OSM_COPYRIGHT_URL, 'https://www.openstreetmap.org/copyright');
  assert.match(sourceNote('photon'), /^Suggestions © OpenStreetMap contributors\./);
  const box = await readFile(new URL('../src/components/AddressSuggest.jsx', import.meta.url), 'utf8');
  const footer = box.slice(box.indexOf('<li role="presentation"'), box.indexOf('</li>', box.indexOf('<li role="presentation"')));
  assert.match(footer, /onMouseDown=\{\(event\) => event\.preventDefault\(\)\}/);
  assert.match(footer, /source === 'photon'[\s\S]*?<a href=\{OSM_COPYRIGHT_URL\} target="_blank" rel="noopener noreferrer"[^>]*>OpenStreetMap contributors<\/a>/);
});

// The postal-area hint is OpenStreetMap's and can be wrong (1 of 18 measured), so its note must read as advice, never as a refusal.
test('the postal-area note says it can be ignored', async () => {
  const page = await readFile(new URL('../src/pages/CheckoutEtransfer.jsx', import.meta.url), 'utf8');
  assert.match(page, /note\.kind === 'area-differs' && `Check your postal code: this street is usually in area \$\{note\.area\}, and yours starts with \$\{note\.typed\}\. If yours is right, you can ignore this\.`/);
});

// A failed or expired pick: the free provider never claims to "check" an address, in this note either.
test('a failed pick is worded by the provider', async () => {
  assert.doesNotMatch(pickFailedNote('photon'), /check/i);
  assert.match(pickFailedNote('photon'), /type it below/);
  assert.match(pickFailedNote('canadapost'), /could not check that address/);
  assert.equal(pickFailedNote(undefined), pickFailedNote('canadapost'));
  const box = await readFile(new URL('../src/components/AddressSuggest.jsx', import.meta.url), 'utf8');
  assert.equal((box.match(/setNote\(pickFailedNote\(source\)\)/g) || []).length, 2);
  assert.doesNotMatch(box, /could not check that address/);
});

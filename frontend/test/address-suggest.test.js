// Address suggestions on the e-Transfer form (owner's ask, 2026-10-13). The box itself is proved in a real browser
// (e2e/walk-address-suggest.cjs against a stand-in for Canada Post); these are its rules and the way it is wired in.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DEBOUNCE_MS, MIN_CHARS, QUIET_AFTER_PROBLEM_MS, applyAddress, nextActive, resultsAnnouncement, worthSearching } from '../src/lib/addressSuggest.js';
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
  assert.match(box, /We could not check that address just now\. Please fill it in below\./);
  assert.match(box, /\+ DEBOUNCE_MS|, DEBOUNCE_MS\)/);
  assert.match(box, /await addressApi\.suggest\(text, lastId, controller\.current\.signal\);\s*if \(request !== latest\.current\) return;/, 'a late list never overwrites a newer search');
  assert.match(box, /await addressApi\.retrieve\(suggestion\.id, controller\.current\.signal\);\s*if \(request !== latest\.current\) return;/, 'a late pick never overwrites a newer one');
  assert.match(box, /\{\.\.\.inputProps\}/, 'the page keeps its own test ids and autocomplete');
});

test('the e-Transfer page uses the box only when the server says so, marks "checked" only after a pick, and removes the mark on any edit', async () => {
  const page = await read('../src/pages/CheckoutEtransfer.jsx');
  assert.match(page, /enabled=\{Boolean\(offer\?\.addressSuggest\)\}/);
  assert.match(page, /verified=\{checked\}/);
  assert.match(page, /const ADDRESS_FIELDS = \['line1', 'line2', 'city', 'state', 'zip'\];/);
  assert.match(page, /if \(ADDRESS_FIELDS\.includes\(name\)\) setChecked\(false\);/);
  assert.match(page, /const pickAddress = \(address\) => \{[\s\S]*?setForm\(\(f\) => applyAddress\(f, address\)\);[\s\S]*?setChecked\(true\);/);
  assert.match(page, /inputProps=\{\{ autoComplete: 'address-line1', 'data-testid': 'et-line1' \}\}/, 'browser autofill and the test id are kept');
  const api = await read('../src/lib/api.js');
  assert.match(api, /suggest: \(q, lastId, signal\) => publicApi\.get\('\/address\/suggest'/);
  assert.match(api, /retrieve: \(id, signal\) => publicApi\.get\('\/address\/retrieve'/);
});

test('the Privacy page says where the typed address goes', async () => {
  const privacy = await read('../src/pages/policies/Privacy.jsx');
  assert.match(privacy, /heading: "Address suggestions"/);
  assert.match(privacy, /sent through our server to Canada Post's AddressComplete service/);
  assert.match(privacy, /We do not keep those searches/);
  assert.match(privacy, /You can ignore the suggestions and type your address yourself\./);
});

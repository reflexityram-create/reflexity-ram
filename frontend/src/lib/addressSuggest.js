// The rules of the address suggestion box on the e-Transfer form (components/AddressSuggest.jsx), kept apart so they can be tested
// without a browser. The suggestions come from our own API (GET /api/address/suggest and /retrieve), which asks Canada Post (paid,
// exact postal codes) or, when no key is set, Photon on OpenStreetMap data (free: street, city and province, never the postal code).
export const MIN_CHARS = 3;
export const DEBOUNCE_MS = 250;
// After a provider problem the box stays quiet for this long instead of asking on every key.
export const QUIET_AFTER_PROBLEM_MS = 60_000;

// Is there enough typed to search? (The server applies the same floor.) The free provider only suggests houses, so it waits for a number.
export const worthSearching = (text, source = 'canadapost') => {
  const typed = String(text ?? '').trim();
  return typed.length >= MIN_CHARS && (source !== 'photon' || /\d/.test(typed));
};

// Where the suggestions come from, in the words under the list. OpenStreetMap's data is open (ODbL) on the condition that it is
// credited next to the results, without a click, with a way to read the licence: the component links "OpenStreetMap contributors" here.
export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';
export const sourceNote = (source) => (source === 'photon'
  ? 'Suggestions © OpenStreetMap contributors. You can always type the address yourself.'
  : 'Suggestions from Canada Post. You can always type the address yourself.');

// What the box says when a picked suggestion cannot be filled in (the provider failed, or, with the free one, the suggestion is more
// than 15 minutes old or the server restarted since). The free provider checks nothing, so it must not say "check".
export const pickFailedNote = (source) => (source === 'photon'
  ? 'We could not fill in that address just now. Please type it below.'
  : 'We could not check that address just now. Please fill it in below.');

// Which suggestion is highlighted after a key. -1 means none. Down and Up wrap around; with nothing highlighted, Up goes to the last.
export function nextActive(current, key, count) {
  if (!Number.isInteger(count) || count <= 0) return -1;
  if (key === 'ArrowDown') return current < 0 || current >= count - 1 ? 0 : current + 1;
  if (key === 'ArrowUp') return current <= 0 ? count - 1 : current - 1;
  return current;
}

// Leaving the field (Tab, Escape, a tap elsewhere) drops a SEARCH that is still on its way, never a PICK: the address the buyer
// just chose must still arrive even if they have already tapped the next field.
export const dropsOnDismiss = (inflight) => inflight === 'find';

// A picked, finished address replaces the address fields of the form. The buyer's own apartment or suite stays when the address
// brings none of its own (a unit chosen from the list arrives inside the street line, "5-100 Queen St W").
export const applyAddress = (form, address) => ({
  ...form,
  line1: address.line1,
  line2: address.line2 || form.line2,
  city: address.city,
  state: address.state,
  // The free provider gives no postal code (OpenStreetMap's are only approximate): what the buyer already typed stays.
  zip: address.zip || form.zip,
});

// ── Postal code and province ────────────────────────────────────────────────────────────────────────────────────────────────
// The first letter of a Canadian postal code names the province or territory (X is shared by the Northwest Territories and Nunavut).
const PROVINCES_BY_LETTER = {
  A: ['NL'], B: ['NS'], C: ['PE'], E: ['NB'], G: ['QC'], H: ['QC'], J: ['QC'], K: ['ON'], L: ['ON'], M: ['ON'], N: ['ON'], P: ['ON'],
  R: ['MB'], S: ['SK'], T: ['AB'], V: ['BC'], X: ['NT', 'NU'], Y: ['YT'],
};
const compactPostalCode = (zip) => String(zip ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const COMPLETE_POSTAL_CODE = /^[A-Z]\d[A-Z]\d[A-Z]\d$/;
export const provincesForPostalCode = (zip) => PROVINCES_BY_LETTER[compactPostalCode(zip).charAt(0)] || [];

// The province to select once a complete postal code has been typed, or '' to leave it alone: only when the buyer has not chosen a
// province themselves and the code points to exactly one (a province picked from a suggestion counts as chosen).
export const provinceToSelect = (zip, { touched = false } = {}) => {
  if (touched || !COMPLETE_POSTAL_CODE.test(compactPostalCode(zip))) return '';
  const provinces = provincesForPostalCode(zip);
  return provinces.length === 1 ? provinces[0] : '';
};

// What to tell the buyer about the postal code they typed. It never blocks the order; it points at a likely slip:
//   province: the code belongs to another province than the one selected (only judged once the code is complete)
//   area-differs / area-same: the first three characters against the postal area of the suggested street (`hint`, the free provider's)
export function postalNotes({ zip, state, hint = '' }) {
  const typed = compactPostalCode(zip);
  const notes = [];
  if (COMPLETE_POSTAL_CODE.test(typed)) {
    const provinces = provincesForPostalCode(typed);
    if (provinces.length && !provinces.includes(state)) notes.push({ kind: 'province', provinces, state });
  }
  const area = String(hint ?? '').toUpperCase();
  if (area.length === 3 && typed.length >= 3) notes.push({ kind: typed.slice(0, 3) === area ? 'area-same' : 'area-differs', area, typed: typed.slice(0, 3) });
  return notes;
}

// What a screen reader is told after a search.
export const resultsAnnouncement = (count) => (count === 0 ? 'No suggestions. Keep typing, or fill in the address yourself.' : `${count} ${count === 1 ? 'suggestion' : 'suggestions'} available. Use the up and down arrow keys, then Enter.`);

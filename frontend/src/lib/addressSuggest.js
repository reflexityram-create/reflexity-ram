// The rules of the address suggestion box on the e-Transfer form (components/AddressSuggest.jsx), kept apart so they can be tested
// without a browser. The suggestions come from our own API (GET /api/address/suggest and /retrieve), which asks Canada Post.
export const MIN_CHARS = 3;
export const DEBOUNCE_MS = 250;
// After a provider problem the box stays quiet for this long instead of asking on every key.
export const QUIET_AFTER_PROBLEM_MS = 60_000;

// Is there enough typed to search? (The server applies the same floor.)
export const worthSearching = (text) => String(text ?? '').trim().length >= MIN_CHARS;

// Which suggestion is highlighted after a key. -1 means none. Down and Up wrap around; with nothing highlighted, Up goes to the last.
export function nextActive(current, key, count) {
  if (!Number.isInteger(count) || count <= 0) return -1;
  if (key === 'ArrowDown') return current < 0 || current >= count - 1 ? 0 : current + 1;
  if (key === 'ArrowUp') return current <= 0 ? count - 1 : current - 1;
  return current;
}

// A picked, finished address replaces the address fields of the form. The buyer's own apartment or suite stays when the address
// brings none of its own (a unit chosen from the list arrives inside the street line, "5-100 Queen St W").
export const applyAddress = (form, address) => ({
  ...form,
  line1: address.line1,
  line2: address.line2 || form.line2,
  city: address.city,
  state: address.state,
  zip: address.zip,
});

// What a screen reader is told after a search.
export const resultsAnnouncement = (count) => (count === 0 ? 'No suggestions. Keep typing, or fill in the address yourself.' : `${count} ${count === 1 ? 'suggestion' : 'suggestions'} available. Use the up and down arrow keys, then Enter.`);

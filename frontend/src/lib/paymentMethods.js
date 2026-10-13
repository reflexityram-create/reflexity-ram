// The ways to pay at checkout and what each one saves. The server decides which are on (GET /api/payments/methods) and
// applies the discount itself: everything here is wording and a preview of the same arithmetic, never the source of a price.

// Mirrors backend/src/utils/paymentMethods.js#discountCents: whole cents, rounded half up, on the goods only.
export function discountFor(goods, pct) {
  const cents = Math.max(0, Math.round(Number(goods) * 100) || 0);
  const basisPoints = Math.max(0, Math.round(Number(pct) * 100) || 0);
  return Math.round((cents * basisPoints) / 10000) / 100;
}

export const CARD = 'card';
export const BANK_DEBIT = 'bank_debit';
export const ETRANSFER = 'etransfer';

// How each method is described. `how` is the one honest sentence about what happens next.
export const METHOD_COPY = {
  [CARD]: {
    title: 'Card, Apple Pay or Google Pay',
    how: 'Paid at once on Stripe’s secure page. Promotion codes work here.',
    cta: 'Continue to secure checkout',
  },
  [BANK_DEBIT]: {
    title: 'Bank debit',
    how: 'From a Canadian bank account, through Stripe. The bank takes up to 5 business days to clear it, and we ship once it does.',
    cta: 'Continue to bank debit',
  },
  [ETRANSFER]: {
    title: 'Interac e-Transfer',
    how: (holdHours) => `You place the order, then send the e-Transfer from your own bank. We hold your items for ${holdHours} hours and ship once it arrives.`,
    cta: 'Continue with e-Transfer',
  },
};

export const DEFAULT_HOLD_HOURS = 48;

// The methods the server offers, card first, in a fixed order, and only ones this page knows how to run.
export function offeredMethods(fromServer) {
  const known = [CARD, BANK_DEBIT, ETRANSFER];
  const byId = new Map((Array.isArray(fromServer) ? fromServer : []).map((m) => [m?.id, m]));
  return known
    .filter((id) => id === CARD || byId.has(id))
    .map((id) => {
      const holdHours = id === ETRANSFER ? (Number(byId.get(id)?.holdHours) || DEFAULT_HOLD_HOURS) : undefined;
      const maxUnits = id === ETRANSFER ? Number(byId.get(id)?.maxUnits) : NaN;
      const maxTotal = id === ETRANSFER ? Number(byId.get(id)?.maxTotal) : NaN;
      const copy = METHOD_COPY[id];
      return {
        id, ...copy,
        how: typeof copy.how === 'function' ? copy.how(holdHours) : copy.how,
        discountPct: id === CARD ? 0 : Number(byId.get(id)?.discountPct) || 0,
        ...(holdHours ? { holdHours } : {}),
        ...(Number.isFinite(maxUnits) && maxUnits > 0 ? { maxUnits } : {}),
        ...(Number.isFinite(maxTotal) && maxTotal > 0 ? { maxTotal } : {}),
      };
    });
}

// Why an e-Transfer order of this size is refused, or '' when it is fine. An unpaid order holds real stock for the whole
// hold and one transfer has a limit at most banks, so the server (utils/etransfer.js) refuses a bigger one: this is the same
// rule, so the buyer is told before they fill in a form. `total` is what they would send.
export function etransferSizeProblem({ units, total, maxUnits, maxTotal }, format = (n) => `$${Number(n).toLocaleString('en-CA')}`) {
  if (Number.isFinite(maxUnits) && Number(units) > maxUnits) return `e-Transfer orders are limited to ${maxUnits} items.`;
  if (Number.isFinite(maxTotal) && Math.round(Number(total) * 100) > Math.round(maxTotal * 100)) return `e-Transfer orders are limited to ${format(maxTotal)} CAD.`;
  return '';
}

// "Save 2% ($12.36)" for a method, or '' when it saves nothing.
export function savingsLabel(goods, pct, format) {
  const saved = discountFor(goods, pct);
  return saved > 0 ? `Save ${Number(pct)}% (${format(saved)})` : '';
}

// Postal code as it is saved: A1A 1A1.
export function normalizePostalCode(value) {
  const compact = String(value || '').toUpperCase().replace(/[\s-]+/g, '');
  return /^.{6}$/.test(compact) ? `${compact.slice(0, 3)} ${compact.slice(3)}` : compact;
}

export const POSTAL_CODE = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d$/i;
export const PROVINCES = [
  ['AB', 'Alberta'], ['BC', 'British Columbia'], ['MB', 'Manitoba'], ['NB', 'New Brunswick'], ['NL', 'Newfoundland and Labrador'],
  ['NS', 'Nova Scotia'], ['NT', 'Northwest Territories'], ['NU', 'Nunavut'], ['ON', 'Ontario'], ['PE', 'Prince Edward Island'],
  ['QC', 'Quebec'], ['SK', 'Saskatchewan'], ['YT', 'Yukon'],
];

// "Mon, Oct 15, 3:40 p.m." in Toronto time, for the e-Transfer deadline.
export function torontoDeadline(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.toLocaleString('en-CA', { timeZone: 'America/Toronto', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} (Toronto time)`;
}

// The e-Transfer order form's own checks (the server checks everything again). Returns { field: "what is wrong" }.
const PHONE = /^[0-9+()\-.\s]{7,25}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function validateEtransferForm(form, { needsEmail }) {
  const errors = {};
  if (!form.firstName.trim()) errors.firstName = 'First name';
  if (!form.lastName.trim()) errors.lastName = 'Last name';
  if (needsEmail && !EMAIL.test(form.email.trim())) errors.email = 'A valid email';
  if (!PHONE.test(form.phone.trim())) errors.phone = 'A phone number';
  if (form.line1.trim().length < 3) errors.line1 = 'Street address';
  if (form.city.trim().length < 2) errors.city = 'City';
  if (!POSTAL_CODE.test(form.zip.trim())) errors.zip = 'A Canadian postal code, like M5H 2N2';
  return errors;
}

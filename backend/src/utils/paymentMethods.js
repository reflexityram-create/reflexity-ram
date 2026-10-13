// ─── Ways to pay, and what each one is worth to the buyer ──────────────────────
// Card/wallets (Stripe Checkout, no discount), bank debit (Stripe pre-authorized debit: cheaper for the shop, slower
// to clear) and Interac e-Transfer (no processor fee, confirmed by the owner by hand). The two cheaper ones pass part
// of the saving on as a discount on the GOODS (never on shipping). Everything is switched by environment variables so
// nothing goes live, and no percentage changes, without an explicit setting on the host.
//
//   BANK_DEBIT_ENABLED=true            BANK_DEBIT_DISCOUNT_PCT=1        (default 1)
//   ETRANSFER_ENABLED=true             ETRANSFER_DISCOUNT_PCT=2         (default 2)
//   ETRANSFER_RECIPIENT_EMAIL=...      the address that receives the transfers (auto-deposit on). Required: without
//                                      it e-Transfer is NOT offered, because the shop never guesses where money goes.
//   ETRANSFER_HOLD_HOURS=48            how long an unpaid e-Transfer order keeps its stock (default 48, 6 to 168)
//   ETRANSFER_REMINDER_HOURS=24        when the "we have not received it yet" email goes out (default 24)

const BANK_DEBIT = 'bank_debit';
const ETRANSFER = 'etransfer';
const CARD = 'stripe'; // what Order.paymentMethod has always said for Stripe Checkout (card and wallets)

const flag = (value) => String(value ?? '').trim().toLowerCase() === 'true';
const number = (value, fallback, { min, max }) => {
  if (value === undefined || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Two decimals is the finest a percentage can be, which keeps the arithmetic in whole numbers.
const percentToBasisPoints = (pct) => (Number.isFinite(Number(pct)) ? Math.round(Number(pct) * 100) : 0);

// The discount on `goodsCents`, in whole cents, rounded half up. Shipping and duties are never discounted.
function discountCents(goodsCents, pct) {
  const cents = Math.max(0, Math.round(Number(goodsCents) || 0));
  const bps = Math.max(0, percentToBasisPoints(pct));
  return Math.round((cents * bps) / 10000);
}

function paymentMethodSettings(env = process.env) {
  const recipient = String(env.ETRANSFER_RECIPIENT_EMAIL ?? '').trim().toLowerCase();
  return {
    [BANK_DEBIT]: {
      enabled: flag(env.BANK_DEBIT_ENABLED),
      discountPct: number(env.BANK_DEBIT_DISCOUNT_PCT, 1, { min: 0, max: 5 }),
    },
    [ETRANSFER]: {
      enabled: flag(env.ETRANSFER_ENABLED) && EMAIL.test(recipient),
      discountPct: number(env.ETRANSFER_DISCOUNT_PCT, 2, { min: 0, max: 5 }),
      recipientEmail: EMAIL.test(recipient) ? recipient : null,
      holdHours: Math.round(number(env.ETRANSFER_HOLD_HOURS, 48, { min: 6, max: 168 })),
      reminderHours: Math.round(number(env.ETRANSFER_REMINDER_HOURS, 24, { min: 1, max: 72 })),
    },
  };
}

const bankDebitEnabled = (env = process.env) => paymentMethodSettings(env)[BANK_DEBIT].enabled;
const etransferEnabled = (env = process.env) => paymentMethodSettings(env)[ETRANSFER].enabled;

// What the storefront may know: which methods exist and their discounts. The e-Transfer address is deliberately NOT
// here; a buyer is shown it only inside their own order, after ordering.
function publicPaymentMethods(env = process.env) {
  const settings = paymentMethodSettings(env);
  return [
    { id: 'card', label: 'Card, Apple Pay or Google Pay', discountPct: 0 },
    ...(settings[BANK_DEBIT].enabled ? [{ id: BANK_DEBIT, label: 'Bank debit', discountPct: settings[BANK_DEBIT].discountPct }] : []),
    ...(settings[ETRANSFER].enabled ? [{ id: ETRANSFER, label: 'Interac e-Transfer', discountPct: settings[ETRANSFER].discountPct, holdHours: settings[ETRANSFER].holdHours }] : []),
  ];
}

const orderPaymentLabel = (method) => ({ [BANK_DEBIT]: 'Bank debit', [ETRANSFER]: 'Interac e-Transfer' }[method] || 'Card');

module.exports = {
  BANK_DEBIT,
  ETRANSFER,
  CARD,
  discountCents,
  percentToBasisPoints,
  paymentMethodSettings,
  bankDebitEnabled,
  etransferEnabled,
  publicPaymentMethods,
  orderPaymentLabel,
};

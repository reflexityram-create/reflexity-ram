// ─── Setting stock aside while a buyer is in Stripe Checkout ───────────────────────────────────────────────
// A paid order takes its stock when the payment is confirmed (utils/stock.js, decrementStockForOrder). Until then nothing
// stopped two buyers from both paying for the last unit: the second payment found nothing left, was clamped to zero, and the
// owner was alerted "Oversold" to refund it by hand. Now, when a buyer is sent to Stripe, what they asked for is HELD for a
// short while (30 minutes, 60 for a bank debit; CHECKOUT_STOCK_HOLD_MINUTES changes the first). Another buyer who asks for
// the same unit meanwhile is told it is being checked out and can try again later.
//
// A hold changes no stock number. What one buyer can have is the stock minus the live holds of EVERYONE ELSE, so a buyer's own
// hold (a second attempt, a retry after the back button) never blocks them. Holds live in the product document itself
// (`stockHolds`): checking "enough left?" and writing the hold is then ONE atomic update on that document, which is what makes
// two simultaneous buyers of the last unit come out one-and-one (a separate collection would need a transaction and could not
// be made safe against two writers that touch different rows).
//
// Everything here is advisory and fails open: if the hold cannot be written the sale goes ahead as it always did, and a payment
// that arrives after its hold lapsed is still handled by the old clamp-and-alert path in utils/stock.js. Nothing here moves money.

const Product = require('../models/Product');

const DEFAULT_HOLD_MINUTES = 30;
const BANK_DEBIT_HOLD_MINUTES = 60;   // an instant bank verification can take longer than a card form
const MIN_MINUTES = 5;
const MAX_MINUTES = 240;

const holdMinutes = ({ bankDebit = false } = {}) => {
  const configured = Number(process.env.CHECKOUT_STOCK_HOLD_MINUTES);
  const base = Number.isFinite(configured) && configured >= MIN_MINUTES && configured <= MAX_MINUTES ? Math.floor(configured) : DEFAULT_HOLD_MINUTES;
  return bankDebit ? Math.max(base, BANK_DEBIT_HOLD_MINUTES) : base;
};

// Who a hold belongs to: the signed-in account, else the guest's cart session (the same identity the cart itself uses).
const ownerKey = ({ userId, sessionId } = {}) => {
  if (userId) return `u:${String(userId)}`;
  if (sessionId) return `s:${String(sessionId)}`;
  return null;
};

// Aggregation expressions over a product document (they run inside the database, so the check and the write are one step).
const liveHolds = (now) => ({ $filter: { input: { $ifNull: ['$stockHolds', []] }, as: 'hold', cond: { $gt: ['$$hold.expiresAt', now] } } });
const liveHoldsOfOthers = (now, owner) => ({ $filter: { input: liveHolds(now), as: 'hold', cond: { $ne: ['$$hold.owner', owner] } } });
const heldByOthers = (now, owner) => ({ $sum: { $map: { input: liveHoldsOfOthers(now, owner), as: 'hold', in: '$$hold.qty' } } });
// True when `qty` units are free for `owner`: the stock, less what other buyers have set aside.
const freeForExpr = (now, owner, qty) => ({ $gte: [{ $subtract: [{ $ifNull: ['$stockQuantity', 0] }, heldByOthers(now, owner)] }, qty] });

// What a product document says about availability for `owner`, read back in plain JS (for the message to the buyer).
function availabilityOf(product, owner, now = new Date()) {
  const stock = Math.max(0, Number(product?.stockQuantity) || 0);
  const others = (product?.stockHolds || []).filter((hold) => hold.owner !== owner && new Date(hold.expiresAt) > now);
  const held = others.reduce((sum, hold) => sum + (Number(hold.qty) || 0), 0);
  const freeAt = others.length ? new Date(Math.min(...others.map((hold) => new Date(hold.expiresAt).getTime()))) : null;
  return { stock, held, available: Math.max(0, stock - held), freeAt };
}

const minutesUntil = (when, now) => Math.max(1, Math.ceil((when.getTime() - now.getTime()) / 60000));

// The sentence a buyer sees when a hold refuses them.
function shortageMessage({ name, qty }, { stock, held, available, freeAt }, now) {
  const wait = freeAt ? ` It frees up within ${minutesUntil(freeAt, now)} minute${minutesUntil(freeAt, now) === 1 ? '' : 's'} if they do not finish.` : '';
  if (stock <= 0) return `"${name}" just sold out.`;
  if (held <= 0) return `Only ${stock} unit${stock === 1 ? '' : 's'} of "${name}" available.`;
  if (available <= 0) return `"${name}" is being checked out by another buyer right now.${wait} Try again then.`;
  return `Only ${available} of "${name}" can be set aside right now: another buyer is checking out with the rest.${wait} Lower the quantity, or try again then.`;
}

/**
 * Set aside every line for `owner`, replacing any hold they already had. All or nothing: if one line cannot be had, the
 * owner's holds are dropped again and nothing stays held. Returns { ok: true } or { ok: false, status: 409, message }.
 * `lines` are { product: <id>, name, qty }; a product named twice counts once, with the quantities added.
 */
async function holdStockForCheckout({ owner, lines, minutes = holdMinutes(), now = new Date(), ProductModel = Product }) {
  if (!owner) return { ok: true, held: false };
  const wanted = new Map();
  for (const line of lines || []) {
    const qty = Number(line.qty);
    if (!line.product || !Number.isInteger(qty) || qty < 1) continue;
    const key = String(line.product);
    const current = wanted.get(key);
    wanted.set(key, { product: line.product, name: line.name, qty: (current?.qty || 0) + qty });
  }
  const expiresAt = new Date(now.getTime() + minutes * 60000);
  try {
    for (const line of wanted.values()) {
      const updated = await ProductModel.findOneAndUpdate(
        { _id: line.product, $expr: freeForExpr(now, owner, line.qty) },
        // The new array is: the live holds of everyone else (this also drops expired ones) plus this owner's, replacing their old one.
        [{ $set: { stockHolds: { $concatArrays: [liveHoldsOfOthers(now, owner), [{ owner, qty: line.qty, expiresAt }]] } } }],
        { returnDocument: 'after', timestamps: false, updatePipeline: true, projection: { _id: 1 } },
      );
      if (updated) continue;
      await releaseCheckoutHold(owner, { ProductModel });
      const current = await ProductModel.findById(line.product).select('+stockHolds stockQuantity name').lean();
      if (!current) return { ok: false, status: 409, message: `"${line.name}" is no longer available.` };
      return { ok: false, status: 409, message: shortageMessage({ name: current.name || line.name, qty: line.qty }, availabilityOf(current, owner, now), now) };
    }
  } catch (err) {
    // A write that threw part-way (the database dropped for a moment): do not leave the lines already held locked for a checkout
    // that will go ahead without a hold (the caller fails open).
    await releaseCheckoutHold(owner, { ProductModel }).catch(() => {});
    throw err;
  }
  return { ok: true, held: true, expiresAt };
}

/** Give back everything `owner` has set aside (they paid, chose another way to pay, or the session could not be made). */
async function releaseCheckoutHold(owner, { ProductModel = Product, session = null } = {}) {
  if (!owner) return 0;
  const result = await ProductModel.updateMany(
    { 'stockHolds.owner': owner },
    [{ $set: { stockHolds: { $filter: { input: { $ifNull: ['$stockHolds', []] }, as: 'hold', cond: { $ne: ['$$hold.owner', owner] } } } } }],
    { timestamps: false, updatePipeline: true, ...(session ? { session } : {}) },
  );
  return result?.modifiedCount || 0;
}

module.exports = {
  DEFAULT_HOLD_MINUTES,
  BANK_DEBIT_HOLD_MINUTES,
  holdMinutes,
  ownerKey,
  freeForExpr,
  availabilityOf,
  shortageMessage,
  holdStockForCheckout,
  releaseCheckoutHold,
};

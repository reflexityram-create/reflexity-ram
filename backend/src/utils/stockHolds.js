// ─── Setting stock aside while a buyer is in Stripe Checkout ───────────────────────────────────────────────
// A paid order takes its stock when the payment is confirmed (utils/stock.js, decrementStockForOrder). Until then nothing
// stopped two buyers from both paying for the last unit: the second payment found nothing left, was clamped to zero, and the
// owner was alerted "Oversold" to refund it by hand. Now, when a buyer is sent to Stripe, what they asked for is HELD for a
// short while (30 minutes, 60 for a bank debit; CHECKOUT_STOCK_HOLD_MINUTES changes the first). Another buyer who asks for
// the same unit meanwhile is told it is being checked out and can try again later.
//
// A hold changes no stock number. What one buyer can have is the stock minus the live holds of EVERYONE ELSE, so a buyer's own
// hold (a second attempt, a retry after the back button) never blocks them. A buyer has one hold per product, remembering which Stripe
// page it was made for (`sessionId`): paying on that page gives back exactly that hold, never a newer one the same buyer made since.
//
// Holds live in the product document itself (`stockHolds`): checking "enough left?" and writing the hold is ONE atomic update on that
// document, which is what makes two simultaneous buyers of the last unit come out one-and-one (a separate collection would let two
// writers that touch different rows both succeed). A cart's lines are held in one database transaction, so they are all made or none
// is, and a refused try leaves everything exactly as it was.
//
// Everything here is advisory and fails open: if the hold cannot be written the sale goes ahead as it always did, and a payment
// that arrives after its hold lapsed is still handled by the old clamp-and-alert path in utils/stock.js. Nothing here moves money.

const Product = require('../models/Product');

const DEFAULT_HOLD_MINUTES = 30;
const BANK_DEBIT_HOLD_MINUTES = 60;   // an instant bank verification can take longer than a card form
const MIN_MINUTES = 5;
const MAX_MINUTES = 240;

// How long a buyer may be kept waiting while the database sorts out who gets the last unit (two carts after the same products wait
// for each other). Past it the transaction is cancelled by the driver itself and the checkout goes ahead without a hold.
const DEFAULT_TRANSACTION_TIMEOUT_MS = 5000;
const holdTimeoutMs = () => {
  const configured = Number(process.env.CHECKOUT_HOLD_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : DEFAULT_TRANSACTION_TIMEOUT_MS;
};

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

class HoldRefused extends Error {
  constructor(line) { super(`Not enough free: ${line.name}`); this.name = 'HoldRefused'; this.line = line; }
}

/**
 * Set aside every line for `owner` (for the Stripe page `sessionId`), replacing the hold they already had on those products. All or
 * nothing, in ONE database transaction: if any line cannot be had the whole thing rolls back, so nobody ever sees a half-made hold and
 * the buyer's earlier hold (an earlier, still payable page) is exactly as it was. Two buyers after the last unit meet on the same
 * product document and one of them is made to wait for the other, then sees its hold. When it works, holds the buyer had on products
 * that are no longer in this cart are given up in the same transaction. The transaction gives up by itself after `timeoutMs`.
 * `now` is only for tests: each attempt of the transaction (it is retried on a transient error) works from the time it runs at.
 * Returns { ok: true } or { ok: false, status: 409, message }. `lines` are { product: <id>, name, qty }; a product named twice counts
 * once, with the quantities added.
 */
async function holdStockForCheckout({ owner, sessionId = null, lines, minutes = holdMinutes(), now = null, timeoutMs = holdTimeoutMs(), ProductModel = Product }) {
  if (!owner) return { ok: true, held: false };
  const wanted = new Map();
  for (const line of lines || []) {
    const qty = Number(line.qty);
    if (!line.product || !Number.isInteger(qty) || qty < 1) continue;
    const key = String(line.product);
    const current = wanted.get(key);
    wanted.set(key, { product: line.product, name: line.name, qty: (current?.qty || 0) + qty });
  }
  // The same order for everyone: two carts with the same products never wait on each other in opposite orders.
  const ordered = [...wanted.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, line]) => line);
  let expiresAt;
  const session = await ProductModel.startSession();
  try {
    await session.withTransaction(async () => {
      const at = now || new Date();
      expiresAt = new Date(at.getTime() + minutes * 60000);
      for (const line of ordered) {
        const updated = await ProductModel.findOneAndUpdate(
          { _id: line.product, $expr: freeForExpr(at, owner, line.qty) },
          // The new array is: the live holds of everyone else (this also drops expired ones) plus this owner's, replacing their old one.
          [{ $set: { stockHolds: { $concatArrays: [liveHoldsOfOthers(at, owner), [{ owner, sessionId, qty: line.qty, expiresAt }]] } } }],
          { returnDocument: 'after', timestamps: false, updatePipeline: true, projection: { _id: 1 }, session },
        );
        if (!updated) throw new HoldRefused(line);   // rolls the whole transaction back
      }
      // The cart this hold is for is the buyer's cart now: what they held on products they have since taken out is not needed.
      await releaseCheckoutHold(owner, { ProductModel, session, exceptProducts: ordered.map((line) => line.product) });
    }, { timeoutMS: timeoutMs });
  } catch (err) {
    if (!(err instanceof HoldRefused)) throw err;
    const current = await ProductModel.findById(err.line.product).select('+stockHolds stockQuantity name').lean();
    if (!current) return { ok: false, status: 409, message: `"${err.line.name}" is no longer available.` };
    const readAt = now || new Date();
    return { ok: false, status: 409, message: shortageMessage({ name: current.name || err.line.name, qty: err.line.qty }, availabilityOf(current, owner, readAt), readAt) };
  } finally {
    await session.endSession();
  }
  return { ok: true, held: true, expiresAt };
}

/**
 * Give back what `owner` has set aside: all of it (a guest who signed in, an e-Transfer order made instead), only what belongs to
 * the Stripe page `sessionId` (that page was paid: a newer page's hold survives), and/or everything except `exceptProducts`.
 */
async function releaseCheckoutHold(owner, { ProductModel = Product, session = null, sessionId = null, exceptProducts = null } = {}) {
  if (!owner) return 0;
  const mine = sessionId
    ? { $and: [{ $eq: ['$$hold.owner', owner] }, { $eq: ['$$hold.sessionId', sessionId] }] }
    : { $eq: ['$$hold.owner', owner] };
  const result = await ProductModel.updateMany(
    {
      'stockHolds.owner': owner,
      ...(sessionId ? { 'stockHolds.sessionId': sessionId } : {}),
      ...(exceptProducts ? { _id: { $nin: exceptProducts } } : {}),
    },
    [{ $set: { stockHolds: { $filter: { input: { $ifNull: ['$stockHolds', []] }, as: 'hold', cond: { $not: [mine] } } } } }],
    { timestamps: false, updatePipeline: true, ...(session ? { session } : {}) },
  );
  return result?.modifiedCount || 0;
}

module.exports = {
  DEFAULT_HOLD_MINUTES,
  BANK_DEBIT_HOLD_MINUTES,
  holdMinutes,
  holdTimeoutMs,
  ownerKey,
  freeForExpr,
  availabilityOf,
  shortageMessage,
  holdStockForCheckout,
  releaseCheckoutHold,
  HoldRefused,
};

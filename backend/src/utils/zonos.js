// ─── US import duties and fees, quoted live by Zonos ───────────────────────────
// Every US parcel needs its duties prepaid (see config/shipping.js, "United States"). The shop's Zonos Verified
// Account pays US Customs when the Canada Post label is made and bills the owner's card; this asks Zonos's Landed
// Cost API what that will be, so the buyer can reimburse it at checkout. A QUOTE only: no Zonos order is created, so
// nothing is billed by this call (Zonos charges when an order is created from a quote, which this never does).
//
// The numbers on 2026-10-06, for the record: a $135 stick came to duties $34.52 + fees $9.79 = $44.31 CAD, the
// duties being the 25% Section 232 semiconductor tariff (a China-made stick adds Section 301, another 25%). Zonos
// knows the current rules; this code only asks, checks the answer is sane and passes it on.
//
// Credentials: ZONOS_API_KEY, the account's API credential (sent as the `credentialToken` header). Without it the
// United States is simply not offered.

const ENDPOINT = 'https://api.zonos.com/graphql';
const TIMEOUT_MS = 10 * 1000;
const CACHE_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;
// A memory module weighs 50-80 g; Zonos wants some weight to place the item in a carton.
const WEIGHT_KG_PER_STICK = 0.1;
// A quote above twice the goods' value is a mistake (decimals, a wrong code), not a tariff: refuse rather than charge it.
const MAX_QUOTE_OVER_GOODS = 2;

// partyCreateWorkflow -> itemCreateWorkflow -> cartonizeWorkflow -> shipmentRatingCreateWorkflow (our own Canada Post
// price, so the quote knows what shipping costs) -> landedCostCalculateWorkflow: one request, one shared workflow root.
const QUOTE_MUTATION = `
mutation UsDutyQuote($parties: [PartyCreateWorkflowInput!]!, $items: [ItemCreateWorkflowInput!]!, $ship: ShipmentRatingCreateWorkflowInput!, $lc: LandedCostWorkFlowInput!) {
  partyCreateWorkflow(input: $parties) { id type }
  itemCreateWorkflow(input: $items) { id sku }
  cartonizeWorkflow { id }
  shipmentRatingCreateWorkflow(input: $ship) { id amount }
  landedCostCalculateWorkflow(input: $lc) {
    id
    amountSubtotals { items shipping duties taxes fees landedCostTotal }
    duties { amount currency }
    taxes { amount currency }
    fees { amount currency }
  }
}`;

class ZonosError extends Error {}

const isConfigured = () => Boolean(process.env.ZONOS_API_KEY);

const money = (value) => Math.round(Number(value) * 100) / 100;

const cache = new Map();
const clearZonosCacheForTest = () => cache.clear();

const variablesFor = ({ lines, shippingCad, shipServiceCode, shipServiceName }) => ({
  parties: [
    // Country and province are all the duty needs: no street or postal code leaves the shop.
    { type: 'ORIGIN', location: { countryCode: 'CA', administrativeAreaCode: 'ON', locality: 'Toronto' } },
    { type: 'DESTINATION', location: { countryCode: 'US' } },
  ],
  items: lines.map((line) => ({
    sku: line.sku,
    name: line.name,
    description: line.name,
    customsDescription: line.name,
    amount: money(line.unitPriceCad),
    currencyCode: 'CAD',
    quantity: line.qty,
    countryOfOrigin: line.countryOfOrigin,
    hsCode: line.hsCode,
    itemType: 'PHYSICAL_GOOD',
    measurements: [{ type: 'WEIGHT', value: WEIGHT_KG_PER_STICK, unitOfMeasure: 'KILOGRAM' }],
  })),
  ship: { amount: money(shippingCad), currencyCode: 'CAD', serviceLevelCode: shipServiceCode, displayName: shipServiceName },
  // DDP: the seller (us, through Zonos) pays at the border. NOT_FOR_RESALE: a consumer's own use.
  lc: { method: 'DDP', calculationMethod: 'DDP', endUse: 'NOT_FOR_RESALE', tariffRate: 'ZONOS_PREFERRED', currencyCode: 'CAD', quoteType: 'API' },
});

// One deadline for the whole exchange, body included: a Zonos answer that stalls after its headers must not hang a buyer's
// checkout, and the race ends the wait even when the fetch implementation ignores the abort signal.
const post = async (variables, fetchImpl, timeoutMs = TIMEOUT_MS) => {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new ZonosError('Zonos did not answer in time')); }, timeoutMs);
  });
  const exchange = (async () => {
    try {
      const res = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { credentialToken: process.env.ZONOS_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: QUOTE_MUTATION, variables }),
        signal: controller.signal,
      });
      if (!res.ok) throw new ZonosError(`Zonos answered HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (err instanceof ZonosError) throw err;
      throw new ZonosError(err?.name === 'AbortError' ? 'Zonos did not answer in time' : `Zonos request failed: ${err?.message || err}`);
    }
  })();
  try {
    return await Promise.race([exchange, deadline]);
  } finally {
    clearTimeout(timer);
    exchange.catch(() => {}); // a failure that lands after the deadline is not an unhandled rejection
  }
};

// Zonos sends amounts as numbers. A missing or null one must never read as 0 (Number(null) is 0), because a quote
// that quietly says "nothing due" would be charged as shipping only, with the shop paying the duties at label time.
const amount = (value) => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '') ? Number(value) : NaN);

// What Zonos said, or a ZonosError when it is missing, in another currency, or does not add up.
const readQuote = (body, goodsValue) => {
  if (Array.isArray(body?.errors) && body.errors.length) {
    throw new ZonosError(`Zonos refused the quote: ${String(body.errors[0]?.message || 'unknown error').slice(0, 200)}`);
  }
  const quote = body?.data?.landedCostCalculateWorkflow?.[0];
  const subtotals = quote?.amountSubtotals;
  if (!quote || !subtotals) throw new ZonosError('Zonos returned no landed cost');
  const duties = amount(subtotals.duties);
  const fees = amount(subtotals.fees);
  const taxes = amount(subtotals.taxes);
  if (![duties, fees, taxes].every((n) => Number.isFinite(n) && n >= 0)) throw new ZonosError('Zonos returned unusable amounts');
  const currencies = [...(quote.duties || []), ...(quote.fees || []), ...(quote.taxes || [])].map((row) => row.currency);
  if (currencies.some((currency) => currency !== 'CAD')) throw new ZonosError('Zonos quoted in a currency other than CAD');
  const total = money(duties + fees + taxes);
  // Every real quote carries fees (about $10 even for one stick). Nothing at all means the answer is incomplete.
  if (!(total > 0)) throw new ZonosError('Zonos returned a landed cost of zero');
  // Both of these must be present: a missing field is a refusal, not a check that quietly does nothing.
  const reported = amount(subtotals.landedCostTotal);
  if (!Number.isFinite(reported) || Math.abs(reported - total) > 0.02) throw new ZonosError('Zonos landed cost total does not match its parts');
  // It must have priced the goods we sent (a unit-versus-total mix-up would show here).
  const priced = amount(subtotals.items);
  if (!Number.isFinite(priced) || Math.abs(priced - goodsValue) > 0.02) throw new ZonosError('Zonos priced different goods than the cart');
  if (total > goodsValue * MAX_QUOTE_OVER_GOODS) throw new ZonosError('Zonos duty total is out of range for the goods');
  return { quoteId: String(quote.id || ''), duties: money(duties), fees: money(fees), taxes: money(taxes), total };
};

// lines: [{ sku, name, qty, unitPriceCad, hsCode, countryOfOrigin }] (all required); shippingCad: what the buyer pays
// Canada Post. Returns { quoteId, duties, fees, taxes, total } in CAD, `total` being what the buyer reimburses.
const quoteUsDuties = async ({ lines, shippingCad, shipServiceCode, shipServiceName, fetchImpl = fetch, now = Date.now, timeoutMs = TIMEOUT_MS }) => {
  if (!isConfigured()) throw new ZonosError('Zonos is not configured');
  if (!Array.isArray(lines) || !lines.length) throw new ZonosError('No items to quote');
  const goodsValue = money(lines.reduce((sum, line) => sum + money(line.unitPriceCad) * line.qty, 0));
  const key = JSON.stringify([lines.map((l) => [l.sku, l.qty, money(l.unitPriceCad), l.countryOfOrigin, l.hsCode]), money(shippingCad)]);
  const hit = cache.get(key);
  if (hit && now() - hit.at < CACHE_MS) return hit.quote;
  const body = await post(variablesFor({ lines, shippingCad, shipServiceCode, shipServiceName }), fetchImpl, timeoutMs);
  const quote = readQuote(body, goodsValue);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: now(), quote });
  return quote;
};

module.exports = { isConfigured, quoteUsDuties, ZonosError, clearZonosCacheForTest, ENDPOINT };

// ─── Checkout to the United States: shipping + prepaid duties, worked out once ──
// Both the quote endpoint (what the checkout page shows) and the Stripe session (what is charged) call this with the
// same cart, so the two can never disagree, and nothing the browser sends is a price. See config/shipping.js, "United
// States", for why duties are prepaid and how they travel (inside the shipping rate).

const Product = require('../models/Product');
const { US_MAX_STICKS, US_MAX_GOODS_CAD } = require('../config/shipping');
const { isConfigured: canadaPostConfigured } = require('./canadaPost');
const { unitedStatesOption } = require('./internationalShipping');
const zonos = require('./zonos');

// A refusal the buyer can be shown: the HTTP status to answer with and the sentence to say.
class UsCheckoutError extends Error {
  constructor(status, publicMessage) {
    super(publicMessage);
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

const NOT_OPEN = 'United States orders are not open for this order yet. Email us and we will arrange it.';
const ORIGIN = /^[A-Z]{2}$/;
const HS_CODE = /^\d{4}(\.?\d{2}){0,3}$/;
const money = (value) => Math.round(Number(value) * 100) / 100;

// Customs lines from the cart's [{ product, qty }]. The country of origin and HS code are the products' saved ones;
// a missing one is never guessed (it is declared to customs), it just keeps that item off US checkout.
const customsLines = (lines) => lines.map(({ product, qty }) => {
  const sku = String(product?.sku || '').trim();
  const origin = String(product?.countryOfOrigin || '').trim().toUpperCase();
  const hsCode = String(product?.hsCode || '').trim();
  const price = Number(product?.price);
  if (!sku || !ORIGIN.test(origin) || !HS_CODE.test(hsCode) || !(price > 0) || !(qty >= 1)) {
    throw new UsCheckoutError(422, `"${product?.name || 'This item'}" cannot be ordered to the United States from the website yet. Email us and we will arrange it.`);
  }
  return { sku, name: String(product.name || sku).slice(0, 120), qty, unitPriceCad: price, hsCode, countryOfOrigin: origin };
});

// lines: [{ product, qty }] for what the cart would charge for. Resolves
// { country, sticks, service, duties: { quoteId, duties, fees, taxes, total }, total } (`total` is shipping + duties:
// what the Stripe shipping rate charges) or throws a UsCheckoutError.
const quoteUnitedStates = async ({ lines, deps = {} }) => {
  const zonosApi = deps.zonos || zonos;
  const shippingFor = deps.unitedStatesOption || unitedStatesOption;
  if (!zonosApi.isConfigured() || !canadaPostConfigured()) throw new UsCheckoutError(422, NOT_OPEN);
  const sticks = lines.reduce((n, line) => n + (Number(line.qty) || 0), 0);
  if (sticks > US_MAX_STICKS) {
    throw new UsCheckoutError(422, `United States checkout takes up to ${US_MAX_STICKS} sticks per order. Email us for a bigger order.`);
  }
  const items = customsLines(lines);
  const goods = money(items.reduce((sum, item) => sum + item.unitPriceCad * item.qty, 0));
  if (goods > US_MAX_GOODS_CAD) {
    throw new UsCheckoutError(422, `United States checkout takes orders up to $${US_MAX_GOODS_CAD.toLocaleString('en-CA')} (bigger shipments need a formal customs entry). Email us and we will arrange it.`);
  }

  let service;
  try {
    service = await shippingFor({ sticks });
  } catch (err) {
    console.error('US shipping quote error:', err.message);
    throw new UsCheckoutError(502, 'Could not get Canada Post prices right now. Please try again.');
  }
  if (!service) throw new UsCheckoutError(422, 'Canada Post has no tracked service to the United States for this order right now. Email us for a quote.');

  let duties;
  try {
    duties = await zonosApi.quoteUsDuties({
      lines: items, shippingCad: service.price, shipServiceCode: service.serviceCode, shipServiceName: service.name,
    });
  } catch (err) {
    console.error('US duties quote error:', err.message);
    throw new UsCheckoutError(502, 'Could not work out US import duties right now. Please try again in a minute, or email us.');
  }
  return { country: 'US', sticks, service, duties, total: money(service.price + duties.total) };
};

// Is the United States worth listing at all: configured, and at least one sellable stick with the customs data
// saved. Cached for a minute (the country list is fetched on every checkout visit).
const AVAILABLE_MS = 60 * 1000;
let availability = { at: 0, value: false };
const clearUsCheckoutCacheForTest = () => { availability = { at: 0, value: false }; };

const usCheckoutAvailable = async ({ now = Date.now, exists = (filter) => Product.exists(filter) } = {}) => {
  if (!zonos.isConfigured() || !canadaPostConfigured()) return false;
  if (now() - availability.at < AVAILABLE_MS) return availability.value;
  const found = await exists({
    isActive: true,
    line: 'Server',
    stockQuantity: { $gt: 0 },
    countryOfOrigin: { $regex: '^[A-Z]{2}$' },
    hsCode: { $regex: '^[0-9]{4}' },
  });
  availability = { at: now(), value: Boolean(found) };
  return availability.value;
};

module.exports = { quoteUnitedStates, usCheckoutAvailable, UsCheckoutError, clearUsCheckoutCacheForTest };

// ─── Canada Post labels (Shipping 8.0 API) ─────────────────────────────────────
// A label is a PURCHASE. Create Shipment with transmitShipment=true charges the card saved as the default on the
// Canada Post profile at once. There is no void for it (Void Shipment is for manifested shipments only); a spoiled label
// can only be put up for refund with Canada Post's "Request Shipment Refund", which Canada Post decides. Nothing in this
// file buys anything unless an admin has seen an exact price and approved it:
//
//   quoteLabelOptions()  read-only: live commercial prices from the Rating API, for the admin's choice
//   buyLabel()           re-quotes, refuses when the live price differs from the approved one, claims the order
//                        atomically, then makes ONE Create Shipment call. The request id is the order number, so
//                        Canada Post itself refuses a second shipment for the same order.
//   reconcileLabel()     after an ambiguous failure (timeout, 5xx) asks Canada Post whether the shipment exists
//   fetchLabelPdf()      downloads the PDF again from Canada Post (nothing with the buyer's address is stored here)
//
// Domestic (Canada to Canada) only. Orders abroad stay in Snap Ship: they need customs and the Zonos duties flow.
// Spec: the Shipping and Rating OpenAPI files on the Canada Post developer portal (developer-developpeur.canadapost-postescanada.ca);
// the request bodies built here were validated against them, see the pull request. Needs the app subscribed to Shipping 8.0.

const OrderModel = require('../models/Order');
const canadaPost = require('./canadaPost');
const { parcelForSticks, SHIP_FROM_POSTAL_CODE } = require('../config/shipping');
const { serviceFromOrder } = require('./shippingPreparation');

const SHIPPING_URL = `${canadaPost.BASE}/shipping/v1`;
const RATING_URL = `${canadaPost.BASE}/rating/v1`;

// The services offered in the picker, cheapest-to-fastest. The buyer's own choice (Standard = Expedited Parcel,
// "Faster shipping" = Xpresspost) is preselected; the others are there because the owner asked to see the options.
const SERVICES = [
  { code: 'DOM.EP', name: 'Expedited Parcel' },
  { code: 'DOM.RP', name: 'Regular Parcel' },
  { code: 'DOM.XP', name: 'Xpresspost' },
  { code: 'DOM.PC', name: 'Priority' },
];
const SERVICE_CODES = SERVICES.map((s) => s.code);
const PROVINCES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'];
const POSTAL_CODE = /^[A-Z]\d[A-Z]\d[A-Z]\d$/;
const CUSTOMER_NUMBER = /^\d{1,10}$/;
const PIN = /^[A-Z0-9]{8,24}$/;
const MAX_STICKS = 40; // beyond this the parcel model is a guess: use Snap Ship
const DEFAULT_MAX_DUE = 60; // CAD incl. tax; a price above this is refused until the owner raises CANADA_POST_LABEL_MAX_DUE
const DEFAULT_DAILY_LIMIT = 20; // labels per rolling 24 h
const STALE_CLAIM_MS = 3 * 60 * 1000; // a claim older than this with no answer is an unknown outcome, not "in progress"
const CREATE_TIMEOUT_MS = 45 * 1000; // how long Create Shipment may take before the outcome is called unknown
const DEFAULT_RELEASE_WAIT_MINUTES = 10; // an unfinished purchase cannot be released for a new try before it is this old
const MAX_REQUEST_ID = 32; // the shipment search takes ids of up to 32 characters (Create allows 35): longer order numbers stay in Snap Ship
const MAX_PDF_BYTES = 5 * 1024 * 1024;

class LabelError extends Error {
  constructor(code, message, status = 409, extra = {}) {
    super(message);
    this.name = 'LabelError';
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

const text = (value) => (value == null ? '' : String(value).trim());
const cents = (value) => Math.round(Number(value) * 100);
const money = (value) => Math.round(Number(value) * 100) / 100;

const labelsEnabled = (env = process.env) => env.CANADA_POST_LABELS_ENABLED === 'true';
const maxDue = (env = process.env) => (Number(env.CANADA_POST_LABEL_MAX_DUE) > 0 ? Number(env.CANADA_POST_LABEL_MAX_DUE) : DEFAULT_MAX_DUE);
const dailyLimit = (env = process.env) => (Number(env.CANADA_POST_LABEL_DAILY_LIMIT) > 0 ? Math.floor(Number(env.CANADA_POST_LABEL_DAILY_LIMIT)) : DEFAULT_DAILY_LIMIT);
const releaseWaitMs = (env = process.env) => {
  const raw = text(env.CANADA_POST_LABEL_RELEASE_WAIT_MINUTES);
  const minutes = raw === '' ? DEFAULT_RELEASE_WAIT_MINUTES : Number(raw);
  return (Number.isFinite(minutes) && minutes >= 0 ? minutes : DEFAULT_RELEASE_WAIT_MINUTES) * 60 * 1000;
};
const customerNumber = (env = process.env) => {
  const value = text(env.CANADA_POST_CUSTOMER_NUMBER);
  return CUSTOMER_NUMBER.test(value) ? value : null;
};

// ── Sender (the return address printed on the label) ──────────────────────────────
function senderFromEnv(env = process.env) {
  const originPostal = text(env.CANADA_POST_ORIGIN_POSTAL_CODE).replace(/\s+/g, '').toUpperCase() || SHIP_FROM_POSTAL_CODE;
  const fields = {
    name: text(env.CANADA_POST_SENDER_NAME),
    company: text(env.CANADA_POST_SENDER_COMPANY),
    contactPhone: text(env.CANADA_POST_SENDER_PHONE),
    addressLine1: text(env.CANADA_POST_SENDER_ADDRESS1),
    addressLine2: text(env.CANADA_POST_SENDER_ADDRESS2),
    city: text(env.CANADA_POST_SENDER_CITY),
    provState: text(env.CANADA_POST_SENDER_PROVINCE).toUpperCase(),
  };
  const missing = [];
  if (!fields.company) missing.push('CANADA_POST_SENDER_COMPANY');
  if (!fields.contactPhone) missing.push('CANADA_POST_SENDER_PHONE');
  if (!fields.addressLine1) missing.push('CANADA_POST_SENDER_ADDRESS1');
  if (!fields.city) missing.push('CANADA_POST_SENDER_CITY');
  if (!PROVINCES.includes(fields.provState)) missing.push('CANADA_POST_SENDER_PROVINCE');
  if (!POSTAL_CODE.test(originPostal)) missing.push('CANADA_POST_ORIGIN_POSTAL_CODE');
  if (fields.addressLine1.length > 44 || fields.addressLine2.length > 44 || fields.city.length > 40 || fields.company.length > 44 || fields.name.length > 44 || fields.contactPhone.length > 25) {
    missing.push('a sender field longer than Canada Post allows');
  }
  if (missing.length) return { ok: false, missing };
  return {
    ok: true,
    originPostal,
    sender: {
      ...(fields.name ? { name: fields.name } : {}),
      company: fields.company,
      contactPhone: fields.contactPhone,
      addressDetails: {
        addressLine1: fields.addressLine1,
        ...(fields.addressLine2 ? { addressLine2: fields.addressLine2 } : {}),
        city: fields.city,
        provState: fields.provState,
        countryCode: 'CA',
        postalZipCode: originPostal,
      },
    },
  };
}

// ── Destination and parcel, from the order ────────────────────────────────────────
function destinationFromOrder(order) {
  const a = order?.shippingAddress || {};
  const problems = [];
  const name = [a.firstName, a.lastName].map(text).filter(Boolean).join(' ').slice(0, 44);
  if (!name) problems.push('the recipient name is missing');
  let line1 = text(a.line1);
  let line2 = text(a.line2);
  if (line1.length > 44) {
    // Canada Post lines are 44 characters. Split at a space and keep the order of the words; never cut a word in two.
    const cut = line1.lastIndexOf(' ', 44);
    const head = cut > 0 ? line1.slice(0, cut) : '';
    const tail = cut > 0 ? line1.slice(cut + 1) : '';
    if (!head || line2 || tail.length > 44) problems.push('the street address is too long for a label line');
    else { line2 = tail; line1 = head; }
  }
  if (!line1) problems.push('the street address is missing');
  if (line2.length > 44) problems.push('address line 2 is too long for a label line');
  const city = text(a.city);
  if (!city || city.length > 40) problems.push('the city is missing or too long');
  const provState = text(a.state).toUpperCase();
  if (!PROVINCES.includes(provState)) problems.push('the province is not a Canadian province code');
  const postalZipCode = text(a.zip).replace(/[\s-]+/g, '').toUpperCase();
  if (!POSTAL_CODE.test(postalZipCode)) problems.push('the postal code is not a valid Canadian postal code');
  const phone = text(a.phone).replace(/[^0-9+\-() x]/gi, '').trim();
  const destination = {
    name,
    ...(phone.length >= 7 && phone.length <= 25 ? { clientVoiceNumber: phone } : {}),
    addressDetails: {
      addressLine1: line1,
      ...(line2 ? { addressLine2: line2 } : {}),
      city,
      provState,
      countryCode: 'CA',
      postalZipCode,
    },
  };
  return { ok: problems.length === 0, destination, postalCode: postalZipCode, problems };
}

function parcelForOrder(order) {
  const sticks = (Array.isArray(order?.items) ? order.items : []).reduce((sum, item) => sum + (Number(item?.qty) || 0), 0);
  if (!Number.isInteger(sticks) || sticks < 1 || sticks > MAX_STICKS) return { ok: false, sticks };
  return { ok: true, sticks, parcel: parcelForSticks(sticks) };
}

// The service the buyer paid for, as a Canada Post code (the picker preselects it).
function recommendedService(order) {
  const { name, signature } = serviceFromOrder(order);
  const haystack = text(name).toLowerCase();
  let code = 'DOM.EP';
  if (/xpresspost/.test(haystack)) code = 'DOM.XP';
  else if (/priority/.test(haystack)) code = 'DOM.PC';
  else if (/regular/.test(haystack)) code = 'DOM.RP';
  return { serviceCode: code, signature: Boolean(signature) };
}

// Can this order be quoted / bought? `switchedOff` is only about buying: quotes are read-only and always allowed.
function labelEligibility(order, env = process.env, now = new Date()) {
  const no = (reason, code = 'not-eligible') => ({ canQuote: false, canBuy: false, code, reason, switchedOff: !labelsEnabled(env) });
  if (!order) return no('Order not found.', 'not-found');
  if (order.paymentStatus !== 'paid') return no('A label can only be bought after payment is confirmed.');
  if (!['pending', 'processing'].includes(order.status)) return no('This order is no longer waiting to ship.');
  const country = text(order.shippingAddress?.country).toUpperCase();
  if (country !== 'CA') return no('Labels for orders outside Canada are bought in Snap Ship (customs and duties are handled there).', 'outside-canada');
  const state = order.label?.status;
  if (state === 'created') return no('A label has already been bought for this order.', 'already-labelled');
  if (state === 'creating') {
    const stale = order.label?.claimedAt && now - new Date(order.label.claimedAt) > STALE_CLAIM_MS;
    return stale
      ? no('The last label purchase never reported back. Check the outcome first.', 'unknown-outcome')
      : no('A label purchase for this order is in progress.', 'in-progress');
  }
  if (state === 'unknown') return no('The last label purchase did not finish cleanly. Check the outcome first.', 'unknown-outcome');
  // "Present" is what the claim filter below calls present (anything but null/missing/''), so the two can never disagree.
  if (order.trackingNumber != null && order.trackingNumber !== '') return no('A tracking number is already saved for this order, so a second label is not offered.', 'has-tracking');
  const orderNumber = text(order.orderNumber);
  if (!orderNumber || orderNumber.length > MAX_REQUEST_ID) return no("This order number does not fit Canada Post's shipment search; buy this label in Snap Ship.", 'odd-order-number');
  const destination = destinationFromOrder(order);
  if (!destination.ok) return no(`This address cannot go on a label: ${destination.problems.join('; ')}.`, 'bad-address');
  if (!parcelForOrder(order).ok) return no('The number of sticks does not fit the standard parcel; buy this label in Snap Ship.', 'odd-parcel');
  const configured = Boolean(env.CANADA_POST_API_KEY && env.CANADA_POST_API_SECRET && customerNumber(env));
  if (!configured) return no('Canada Post is not configured on the server (API key, secret and customer number).', 'not-configured');
  return { canQuote: true, canBuy: labelsEnabled(env), code: null, reason: null, switchedOff: !labelsEnabled(env) };
}

// ── Canada Post calls ───────────────────────────────────────────────────────────
// An error body from the portal: { errors: [{ errorCode, message }] } or { title, detail }.
async function errorFromResponse(res) {
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  const first = Array.isArray(body?.errors) ? body.errors[0] : null;
  const code = text(first?.errorCode || body?.code || '');
  const message = text(first?.message || body?.detail || body?.message || body?.title || `HTTP ${res.status}`).slice(0, 300);
  return { status: res.status, code, message };
}

// Rating: one call per option set. Prices come back per service; the commercial (discounted) price needs the customer number.
async function rate({ parcel, originPostal, postalCode, signature, services = SERVICE_CODES, env, fetchImpl }) {
  const number = customerNumber(env);
  const token = await canadaPost.accessToken(fetchImpl);
  return canadaPost.withDeadline(async (signal) => {
    const res = await fetchImpl(`${RATING_URL}/prices`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json', 'Accept-Language': 'en-CA' },
      body: JSON.stringify({
        quoteType: 'commercial',
        customerNumber: number,
        parcelCharacteristics: parcel,
        originPostalCode: originPostal,
        destination: { domestic: { postalCode } },
        services,
        ...(signature ? { options: [{ optionCode: 'SO' }] } : {}),
      }),
      signal,
    });
    if (!res.ok) {
      const err = await errorFromResponse(res);
      throw new LabelError('rating-failed', `Canada Post could not price this parcel (${err.status}${err.code ? ` ${err.code}` : ''}: ${err.message}).`, 502);
    }
    const quotes = await res.json();
    return Array.isArray(quotes) ? quotes : [];
  }, 'Canada Post rating request');
}

function normalizeQuote(q) {
  const p = q?.priceDetails || {};
  const adjustments = (Array.isArray(p.adjustments) ? p.adjustments : []).reduce((sum, a) => sum + (Number(a.adjustmentCost) || 0), 0);
  const options = (Array.isArray(p.options) ? p.options : []).reduce((sum, o) => sum + (Number(o.optionPrice) || 0), 0);
  const tax = ['gst', 'pst', 'hst'].reduce((sum, key) => sum + (Number(p.taxes?.[key]?.amt) || 0), 0);
  const due = money(p.due);
  if (!Number.isFinite(due) || due <= 0) return null;
  return {
    serviceCode: q.serviceCode,
    serviceName: text(q.serviceName) || SERVICES.find((s) => s.code === q.serviceCode)?.name || q.serviceCode,
    preTax: money((Number(p.base) || 0) + adjustments + options),
    tax: money(tax),
    due,
    expectedDeliveryDate: q.serviceStandard?.expectedDeliveryDate || null,
    transitDays: q.serviceStandard?.expectedTransitTime ?? null,
    guaranteed: Boolean(q.serviceStandard?.guaranteedDelivery),
  };
}

// What the picker shows: every service, with and without the signature option, and what the buyer paid for.
async function quoteLabelOptions(order, deps = {}) {
  const d = { fetchImpl: fetch, env: process.env, now: () => new Date(), ...deps };
  const eligibility = labelEligibility(order, d.env, d.now());
  if (!eligibility.canQuote) throw new LabelError(eligibility.code || 'not-eligible', eligibility.reason, 409);
  const sender = senderFromEnv(d.env);
  const originPostal = sender.ok ? sender.originPostal : SHIP_FROM_POSTAL_CODE;
  const { postalCode } = destinationFromOrder(order);
  const { parcel, sticks } = parcelForOrder(order);
  const [plain, signed, access] = await Promise.all([
    rate({ parcel, originPostal, postalCode, signature: false, env: d.env, fetchImpl: d.fetchImpl }),
    rate({ parcel, originPostal, postalCode, signature: true, env: d.env, fetchImpl: d.fetchImpl }).catch(() => []),
    shippingAccess({ env: d.env, fetchImpl: d.fetchImpl, now: d.now }),
  ]);
  const signedBy = new Map(signed.map(normalizeQuote).filter(Boolean).map((q) => [q.serviceCode, q]));
  const options = plain.map(normalizeQuote).filter((q) => q && SERVICE_CODES.includes(q.serviceCode))
    .map((q) => ({ ...q, withSignature: signedBy.get(q.serviceCode) || null }))
    .sort((a, b) => SERVICE_CODES.indexOf(a.serviceCode) - SERVICE_CODES.indexOf(b.serviceCode));
  if (!options.length) throw new LabelError('no-services', 'Canada Post returned no service for this parcel and address.', 502);
  const recommended = recommendedService(order);
  return {
    parcel: { ...parcel, sticks },
    recommended,
    options,
    buyerPaid: { shipping: money(order.shippingCost), service: serviceFromOrder(order).name, signature: recommended.signature },
    maxDue: maxDue(d.env),
    switchedOff: !labelsEnabled(d.env),
    access,
    checkedAt: d.now().toISOString(),
  };
}

// The Create Shipment body (Shipping 8.0). transmitShipment=true is how a customer without a contract buys a label
// with no manifest; groupId must then be left out.
function buildShipmentRequest(order, { serviceCode, signature, sender, destination, parcel, requestId, format = '8.5x11' }) {
  return {
    customerRequestId: requestId,
    transmitShipment: true,
    requestedShippingPoint: sender.addressDetails.postalZipCode,
    providePricingInfo: true,
    provideReceiptInfo: true,
    deliverySpec: {
      serviceCode,
      sender,
      destination,
      ...(signature ? { options: [{ optionCode: 'SO' }] } : {}),
      parcelCharacteristics: { weight: parcel.weight, dimensions: { ...parcel.dimensions } },
      printPreferences: { outputFormat: format, encoding: 'PDF' },
      preferences: { showPackingInstructions: false, showPostageRate: false, showInsuredValue: false },
      references: { customerRef1: text(order.orderNumber).slice(0, 35) },
      settlementInfo: { intendedMethodOfPayment: 'CreditCard' },
    },
  };
}

// A link Canada Post hands back is only followed when it ends up on the Shipping API host and path. A stray quote or space
// around it (the published Get Shipments example has one) and a path relative to the API host are read as what they mean;
// anything else (another host, http, a path outside /shipping/v1/) is refused.
function trustedShippingLink(href) {
  try {
    const cleaned = text(href).replace(/^["'\s]+|["'\s]+$/g, '');
    if (!cleaned) return null;
    const base = new URL(SHIPPING_URL);
    const url = new URL(cleaned, `${base.origin}/`);
    if (url.protocol !== 'https:' || url.host !== base.host || !url.pathname.startsWith(`${base.pathname}/`)) return null;
    return url.toString();
  } catch { return null; }
}

// The shipment's own label is the link with rel "label"; "returnLabel" is the other way round and is never printed here.
function pickLabelLink(links) {
  const list = Array.isArray(links) ? links : [];
  const usable = (l) => Boolean(trustedShippingLink(l?.href));
  const link = list.find((l) => text(l?.rel).toLowerCase() === 'label' && usable(l))
    || list.find((l) => /pdf/i.test(text(l?.mediaType)) && !/return/i.test(text(l?.rel)) && usable(l));
  return link ? trustedShippingLink(link.href) : null;
}

// `GET .../shipments?request-id=` answers with a bare array of links (the live API answered `[]` for an id nobody used);
// an object wrapping the same list is read too. Anything else is NOT "an empty list": it is an answer we do not understand.
const linkList = (body) => (Array.isArray(body) ? body : Array.isArray(body?.links) ? body.links : null);

// A money amount from Canada Post, or null: a missing or empty value is "not told", never 0.
const amountOrNull = (value) => (value == null || value === '' || !Number.isFinite(Number(value)) ? null : money(value));

function parseShipment(body) {
  const pin = text(body?.trackingPin).replace(/\s+/g, '').toUpperCase();
  const price = body?.shipmentPrice || {};
  const receipt = body?.shipmentReceipt?.ccReceiptDetails || {};
  return {
    shipmentId: text(body?.shipmentId),
    shipmentStatus: text(body?.shipmentStatus).toLowerCase(),
    trackingPin: PIN.test(pin) ? pin : '',
    artifactUrl: pickLabelLink(body?.links),
    // What the card was charged: the receipt's amount when there is one, else the shipment's amount due.
    charged: amountOrNull(receipt.chargeAmount) ?? amountOrNull(price.dueAmount),
    cardType: text(receipt.cardType) || null,
  };
}

async function postCreateShipment(requestBody, { env, fetchImpl, timeoutMs = CREATE_TIMEOUT_MS }) {
  const number = customerNumber(env);
  let token;
  try { token = await canadaPost.accessToken(fetchImpl); } catch (err) {
    // No token, no call: nothing can have been charged.
    return { outcome: 'rejected', status: 0, code: 'token', message: text(err.message).slice(0, 200) };
  }
  try {
    return await canadaPost.withDeadline(async (signal) => {
      const res = await fetchImpl(`${SHIPPING_URL}/${number}/${number}/shipments`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json', 'Accept-Language': 'en-CA' },
        body: JSON.stringify(requestBody),
        signal,
      });
      if (res.ok) {
        let body = null;
        try { body = await res.json(); } catch { /* ok status, unreadable body: money may have moved */ }
        return body ? { outcome: 'ok', body } : { outcome: 'ambiguous', status: res.status, code: '', message: 'Canada Post answered but the answer could not be read.' };
      }
      const err = await errorFromResponse(res);
      // 4xx = the request was refused before anything was processed. 5xx = we cannot know.
      if (res.status >= 400 && res.status < 500) return { outcome: 'rejected', ...err };
      return { outcome: 'ambiguous', ...err };
    }, 'Canada Post create-shipment request', timeoutMs);
  } catch (err) {
    return { outcome: 'ambiguous', status: 0, code: '', message: text(err.message).slice(0, 200) };
  }
}

// ── Buy ──────────────────────────────────────────────────────────────────────────────
async function findLabelOrder(OrderStore, orderId) {
  const query = OrderStore.findById(orderId);
  return query?.lean ? query.lean() : query;
}

function claimFilter(order) {
  return {
    _id: order._id,
    paymentStatus: 'paid',
    status: { $in: ['pending', 'processing'] },
    $and: [
      { $or: [{ 'label.status': null }, { 'label.status': 'failed' }] },
      { $or: [{ trackingNumber: null }, { trackingNumber: '' }] },
    ],
    orderNumber: order.orderNumber,
  };
}

async function buyLabel({ orderId, serviceCode, signature = false, approvedDue, admin }, deps = {}) {
  const d = { Order: OrderModel, fetchImpl: fetch, now: () => new Date(), env: process.env, createTimeoutMs: CREATE_TIMEOUT_MS, ...deps };
  if (!labelsEnabled(d.env)) throw new LabelError('not-enabled', 'Label buying is switched off on the server.', 403);
  if (!SERVICE_CODES.includes(serviceCode)) throw new LabelError('bad-service', 'Choose one of the listed Canada Post services.', 400);
  if (!Number.isFinite(Number(approvedDue)) || Number(approvedDue) <= 0) throw new LabelError('bad-amount', 'The approved price is missing.', 400);

  const order = await findLabelOrder(d.Order, orderId);
  const eligibility = labelEligibility(order, d.env, d.now());
  if (!eligibility.canBuy) throw new LabelError(eligibility.code || 'not-eligible', eligibility.reason, 409);
  const senderConfig = senderFromEnv(d.env);
  if (!senderConfig.ok) throw new LabelError('sender-missing', `The return address for labels is not set up (${senderConfig.missing.join(', ')}).`, 503);

  const { destination, postalCode } = destinationFromOrder(order);
  const { parcel } = parcelForOrder(order);
  const quotes = await rate({
    parcel, originPostal: senderConfig.originPostal, postalCode, signature: Boolean(signature), services: [serviceCode], env: d.env, fetchImpl: d.fetchImpl,
  });
  const live = quotes.map(normalizeQuote).find((q) => q && q.serviceCode === serviceCode);
  if (!live) throw new LabelError('service-unavailable', 'Canada Post does not offer that service for this parcel right now.', 409);
  if (cents(live.due) !== cents(approvedDue)) {
    throw new LabelError('price-changed', `The price changed from $${money(approvedDue).toFixed(2)} to $${live.due.toFixed(2)}. Look at it again before approving.`, 409, { quote: live });
  }
  const cap = maxDue(d.env);
  if (live.due > cap) throw new LabelError('over-cap', `This label costs $${live.due.toFixed(2)}, above the $${cap.toFixed(2)} safety limit. Raise CANADA_POST_LABEL_MAX_DUE to allow it.`, 409);

  // One request id per order for ever: Canada Post refuses a second shipment with the same id, so even a bug here
  // cannot buy two labels for one order.
  const requestId = text(order.orderNumber).slice(0, 35);
  const now = d.now();
  const claimed = await d.Order.findOneAndUpdate(claimFilter(order), {
    $set: {
      'label.status': 'creating',
      'label.requestId': requestId,
      'label.serviceCode': serviceCode,
      'label.serviceName': live.serviceName,
      'label.signature': Boolean(signature),
      'label.approvedDue': live.due,
      'label.approvedBy': admin?._id || admin?.id || null,
      'label.claimedAt': now,
    },
    $unset: { 'label.error': '' },
  }, { returnDocument: 'after' });
  if (!claimed) throw new LabelError('in-progress', 'This order changed or another purchase is already running. Reload it and check.', 409);
  const mine = { _id: order._id, 'label.status': 'creating', 'label.requestId': requestId };

  // The daily limit is counted AFTER the claim, over every purchase that may have charged (running, bought, unclear) and
  // mine included: counted before the claim, a burst of parallel approvals all saw the same number and all went through.
  // Over the limit, the claim is given back and nothing is sent to Canada Post.
  const limit = dailyLimit(d.env);
  let used;
  try {
    used = await d.Order.countDocuments({ 'label.claimedAt': { $gte: new Date(d.now().getTime() - 24 * 60 * 60 * 1000) }, 'label.status': { $in: ['creating', 'created', 'unknown'] } });
  } catch {
    await d.Order.updateOne(mine, { $set: { 'label.status': 'failed', 'label.error': { code: 'limit-check-failed', message: 'The daily limit could not be checked.', at: d.now() } } }).catch(() => {});
    throw new LabelError('limit-check-failed', 'The daily label limit could not be checked, so nothing was bought or charged. Try again in a minute.', 503);
  }
  if (used > limit) {
    await d.Order.updateOne(mine, { $set: { 'label.status': 'failed', 'label.error': { code: 'daily-limit', message: `The daily limit of ${limit} labels was reached.`, at: d.now() } } });
    throw new LabelError('daily-limit', `${used - 1} labels were bought or started in the last 24 hours and the limit is ${limit}, so nothing was bought or charged.`, 429);
  }

  const requestBody = buildShipmentRequest(order, {
    serviceCode, signature: Boolean(signature), sender: senderConfig.sender, destination, parcel, requestId, format: text(d.env.CANADA_POST_LABEL_FORMAT) === '4x6' ? '4x6' : '8.5x11',
  });
  const result = await postCreateShipment(requestBody, { env: d.env, fetchImpl: d.fetchImpl, timeoutMs: d.createTimeoutMs });

  // A refusal that talks about a duplicate means Canada Post already holds a shipment for this order: that is not a
  // "nothing was charged" failure, so it goes to the check-first state.
  if (result.outcome === 'rejected' && /duplicate|already (exists|used)|not unique|unique/i.test(`${result.message} ${result.code}`)) {
    result.outcome = 'ambiguous';
  }
  if (result.outcome === 'rejected') {
    await d.Order.updateOne(mine, { $set: { 'label.status': 'failed', 'label.error': { code: result.code, message: result.message, at: d.now() } } });
    throw new LabelError('canada-post-rejected', `Canada Post refused the label request (${result.status}${result.code ? ` ${result.code}` : ''}: ${result.message}). Nothing was charged.`, 502);
  }
  if (result.outcome === 'ambiguous') {
    await d.Order.updateOne(mine, { $set: { 'label.status': 'unknown', 'label.error': { code: result.code, message: result.message, at: d.now() } } });
    throw new LabelError('unknown-outcome', `Canada Post did not give a clear answer (${result.message}). A label may have been bought: use "Check with Canada Post" before trying again.`, 502);
  }
  return finishCreated(d, order, mine, parseShipment(result.body), live);
}

// Success: store the answer. If the first write fails, try once more, then say the number out loud: the money is spent.
// A shipment Canada Post marks "suspended" has a PIN but is not a valid label: it is kept as `unknown` (to be checked
// again later) and its number is NOT put on the order, so the tracking sync never watches a parcel that cannot ship.
async function finishCreated(d, order, mine, shipment, live) {
  const at = d.now();
  const charged = shipment.charged;
  const suspended = shipment.shipmentStatus === 'suspended';
  const usable = Boolean(shipment.trackingPin) && !suspended;
  const priceNote = live.due ? `, CA$${live.due.toFixed(2)}` : '';
  const update = {
    $set: {
      'label.status': usable ? 'created' : 'unknown',
      'label.shipmentId': shipment.shipmentId,
      'label.shipmentStatus': shipment.shipmentStatus,
      'label.trackingPin': shipment.trackingPin,
      'label.artifactUrl': shipment.artifactUrl,
      'label.price': { preTax: live.preTax, tax: live.tax, due: live.due, charged },
      'label.cardType': shipment.cardType,
      'label.createdAt': at,
      ...(usable ? { trackingNumber: shipment.trackingPin } : {}),
    },
    // MongoDB rejects an empty $unset, so it is only present when it removes something.
    ...(usable ? { $unset: { 'label.error': '', trackingLatest: '', trackingUrl: '' } } : {}),
    $push: { statusHistory: { status: order.status, note: `Shipping label ${usable ? 'bought' : 'created but not usable yet'} (${live.serviceName}${priceNote})`, timestamp: at } },
  };
  // A save that throws (a dropped connection) is handled like one that matches nothing: one more try, then the numbers are
  // said out loud, because the money is spent.
  const trySave = async () => {
    try { return { saved: await d.Order.findOneAndUpdate(mine, update, { returnDocument: 'after' }) }; } catch (error) { return { error }; }
  };
  let attempt = await trySave();
  if (!attempt.saved) attempt = await trySave();
  let saved = attempt.saved;
  if (!saved) {
    // Another check may just have saved this very label: that is a success, not an error.
    const current = await findLabelOrder(d.Order, order._id).catch(() => null);
    if (usable && current?.label?.status === 'created' && current.label.trackingPin === shipment.trackingPin) {
      return { label: labelView(current.label), mismatch: null };
    }
    console.error(`Canada Post label bought but not saved on order ${order.orderNumber}: tracking ${shipment.trackingPin || 'unknown'}, shipment ${shipment.shipmentId || 'unknown'}${attempt.error ? ` (${attempt.error.message})` : ''}`);
    throw new LabelError('save-failed', `The label was bought (tracking ${shipment.trackingPin || 'unknown'}, shipment ${shipment.shipmentId || 'unknown'}) but could not be saved on the order. Save the tracking number on the order by hand.`, 500);
  }
  if (suspended) {
    throw new LabelError('shipment-suspended', `Canada Post created shipment ${shipment.shipmentId || 'unknown'} but marked it suspended, so the label is not valid yet. Look at it in Canada Post's Shipping tools, then use "Check with Canada Post".`, 502);
  }
  if (!shipment.trackingPin) {
    throw new LabelError('no-tracking-number', shipment.shipmentId
      ? `The label was bought (shipment ${shipment.shipmentId}) but Canada Post did not return a tracking number. Use "Check with Canada Post".`
      : 'Canada Post answered without a shipment number or a tracking number, so it is not clear whether a label was made. Use "Check with Canada Post".', 502);
  }
  // Only the label's own view goes back to callers: never the whole order (its address belongs to the buyer).
  return {
    label: labelView(saved.label),
    mismatch: charged != null && cents(charged) !== cents(live.due) ? { approved: live.due, charged } : null,
  };
}

// ── Reconcile, PDF ───────────────────────────────────────────────────────────────────
async function authorizedGet(url, { accept, env, fetchImpl, label }) {
  const token = await canadaPost.accessToken(fetchImpl);
  return canadaPost.withDeadline(async (signal) => {
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: accept, 'Accept-Language': 'en-CA' }, signal });
    return res;
  }, label, 30 * 1000);
}

// Is this app allowed to use the Shipping API at all? A read-only list of the account's no-manifest shipments for today:
// the live API answered it 200 with a list once the app had the Shipping subscription (2026-10-08), and an app without it
// gets 401. It never blocks anything, it only lets the screen say so before a purchase is attempted.
async function shippingAccess({ env, fetchImpl, now }) {
  const number = customerNumber(env);
  const day = now().toISOString().slice(0, 10).replace(/-/g, '');
  try {
    const res = await authorizedGet(`${SHIPPING_URL}/${number}/${number}/shipments?no-manifest=true&date=${day}&limit=1`, { accept: 'application/json', env, fetchImpl, label: 'Canada Post Shipping access check' });
    if (res.ok) return { ok: true, message: null };
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: `Canada Post refused a test read of the Shipping API (HTTP ${res.status}): this site's developer-portal app probably needs the Shipping subscription, or the account may not be allowed to create labels.` };
    }
    return { ok: null, message: `Canada Post's Shipping API could not be checked just now (HTTP ${res.status}).` };
  } catch {
    return { ok: null, message: "Canada Post's Shipping API could not be checked just now." };
  }
}

// ── Unfinished purchases: ask, then (only by an admin's explicit act) release ──────────────────────────────────────────────
const isUnfinished = (order, now) => {
  const state = order?.label?.status;
  const stale = state === 'creating' && order.label?.claimedAt && now - new Date(order.label.claimedAt) > STALE_CLAIM_MS;
  return state === 'unknown' || Boolean(stale);
};

// Asks Canada Post for the shipment of this order's request id: { kind: 'found', shipment } or { kind: 'none' }. Only a clear
// answer counts as "none" (a 404, or an empty list). An error, a 202 ("still working"), a reply that is not a list, or a list
// whose links cannot be followed here is a LabelError and changes nothing: that is "we could not tell", never "nothing was charged".
// The request id is the whole search: against the live API (2026-10-08) adding no-manifest, date or limit to it is a 400
// (9183 "mutually exclusive" / 9185 "limit and date do not apply"), and an id nobody used answers 200 with an empty list.
async function lookupShipment(d, order) {
  const number = customerNumber(d.env);
  if (!number) throw new LabelError('not-configured', 'Canada Post customer number is not configured.', 503);
  const requestId = text(order.label?.requestId || order.orderNumber).slice(0, 35);
  const url = `${SHIPPING_URL}/${number}/${number}/shipments?request-id=${encodeURIComponent(requestId)}`;
  const res = await authorizedGet(url, { accept: 'application/json', env: d.env, fetchImpl: d.fetchImpl, label: 'Canada Post shipment lookup' });
  if (res.status === 404) return { kind: 'none' };
  if (!res.ok || res.status === 202) {
    const err = res.status === 202 ? { status: 202, code: '', message: 'still working' } : await errorFromResponse(res);
    throw new LabelError('lookup-failed', `Canada Post could not say yet (${err.status}${err.code ? ` ${err.code}` : ''}: ${err.message}). Try again in a minute.`, 502);
  }
  let listing = null;
  try { listing = await res.json(); } catch { /* handled below */ }
  const entries = linkList(listing);
  if (entries === null) throw new LabelError('lookup-failed', 'Canada Post answered in a form this site does not understand. Try again in a minute, or look for the label in Canada Post\'s Shipping tools.', 502);
  if (entries.length === 0) return { kind: 'none' };
  const href = entries.filter((l) => /shipment|self/i.test(text(l?.rel))).map((l) => trustedShippingLink(l?.href)).find(Boolean);
  if (!href) {
    throw new LabelError('lookup-failed', 'Canada Post lists a shipment for this order, but its link cannot be followed from here. Look for it in Canada Post\'s Shipping tools and save its tracking number on the order.', 502);
  }
  const detail = await authorizedGet(href, { accept: 'application/json', env: d.env, fetchImpl: d.fetchImpl, label: 'Canada Post shipment lookup' });
  if (!detail.ok) throw new LabelError('lookup-failed', `Canada Post knows the shipment but its details could not be read (${detail.status}).`, 502);
  let body = null;
  try { body = await detail.json(); } catch { /* handled below */ }
  const shipment = parseShipment(body);
  if (!shipment.trackingPin) throw new LabelError('lookup-failed', 'Canada Post knows the shipment but did not give its tracking number.', 502);
  return { kind: 'found', shipment, requestId };
}

// A shipment that exists but was lost to us (the answer to Create never arrived): finish the order from what Canada Post says.
async function completeFromLookup(d, order, found) {
  const state = order.label?.status;
  const live = { serviceName: order.label?.serviceName || '', due: Number(order.label?.approvedDue) || 0, preTax: null, tax: null };
  const mine = { _id: order._id, 'label.status': state, 'label.requestId': order.label?.requestId || found.requestId };
  return finishCreated(d, order, mine, found.shipment, live);
}

// When may an unfinished purchase be released for a new try (and has Canada Post told us it exists)?
function releaseWindow(order, d) {
  const claimedAt = order.label?.claimedAt ? new Date(order.label.claimedAt) : null;
  const after = claimedAt ? new Date(claimedAt.getTime() + releaseWaitMs(d.env)) : null;
  return { after, open: !after || d.now() >= after, hasShipment: Boolean(order.label?.shipmentId) };
}

// "Check with Canada Post": finds the shipment and completes the order, or reports what Canada Post said. It never changes an
// order's state on a negative answer: an empty search proves little (a label made seconds ago may not show yet, and the search
// has not been seen finding a shipment made without a manifest), so only releaseLabel, an admin's own decision, lets go.
async function reconcileLabel(orderId, deps = {}) {
  const d = { Order: OrderModel, fetchImpl: fetch, now: () => new Date(), env: process.env, ...deps };
  const order = await findLabelOrder(d.Order, orderId);
  if (!order) throw new LabelError('not-found', 'Order not found.', 404);
  if (!isUnfinished(order, d.now())) throw new LabelError('nothing-to-check', 'There is no unfinished label purchase to check on this order.', 409);
  const found = await lookupShipment(d, order);
  if (found.kind === 'found') return { found: true, ...(await completeFromLookup(d, order, found)) };
  const window = releaseWindow(order, d);
  return {
    found: false,
    canRelease: window.open && !window.hasShipment,
    shipmentKnown: window.hasShipment,
    releaseAfter: window.after ? window.after.toISOString() : null,
    message: window.hasShipment
      ? 'Canada Post made a shipment for this order earlier, but its search does not show it now. Look at it in Canada Post\'s Shipping tools and save its tracking number on the order.'
      : "Canada Post's search found no shipment for this order. A label made a moment ago can take a few minutes to show up. Before buying again, look in Canada Post's own Shipping tools and at your card statement: only if both show nothing, allow a new purchase.",
  };
}

// The admin's decision, after checking, that nothing was bought: lets the order be bought again. Refused while the first attempt
// may still be finishing (a wait from its start), when Canada Post is known to hold a shipment for the order, and unless a fresh
// search just now finds nothing. Even then Canada Post refuses a second shipment with the same request id.
async function releaseLabel(orderId, { admin } = {}, deps = {}) {
  const d = { Order: OrderModel, fetchImpl: fetch, now: () => new Date(), env: process.env, ...deps };
  const order = await findLabelOrder(d.Order, orderId);
  if (!order) throw new LabelError('not-found', 'Order not found.', 404);
  if (!isUnfinished(order, d.now())) throw new LabelError('nothing-to-check', 'There is no unfinished label purchase on this order.', 409);
  const window = releaseWindow(order, d);
  if (window.hasShipment) {
    throw new LabelError('shipment-exists', `Canada Post made shipment ${order.label.shipmentId} for this order, so a new purchase is not allowed. Look at it in Canada Post's Shipping tools and save its tracking number on the order.`, 409);
  }
  if (!window.open) {
    const minutes = Math.max(1, Math.ceil((window.after - d.now()) / 60000));
    throw new LabelError('too-soon', `Canada Post may still be finishing the first purchase. Check again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`, 409, { releaseAfter: window.after.toISOString() });
  }
  const found = await lookupShipment(d, order);
  if (found.kind === 'found') return { released: false, found: true, ...(await completeFromLookup(d, order, found)) };
  const state = order.label.status;
  const at = d.now();
  const released = await d.Order.findOneAndUpdate({ _id: order._id, 'label.status': state, 'label.requestId': order.label.requestId || null }, {
    $set: { 'label.status': 'failed', 'label.error': { code: 'released', message: "Released by an admin after Canada Post's search found no shipment.", at } },
    $push: { statusHistory: { status: order.status, note: `Label purchase released for a new try by ${admin?.email || 'an admin'} after Canada Post's search found no shipment`, timestamp: at } },
  }, { returnDocument: 'after' });
  if (!released) throw new LabelError('in-progress', 'This order changed while it was being released. Reload it and check.', 409);
  return { released: true, found: false, label: labelView(released.label) };
}

async function downloadPdf(url, d) {
  const res = await authorizedGet(url, { accept: 'application/pdf', env: d.env, fetchImpl: d.fetchImpl, label: 'Canada Post label download' });
  if (!res.ok) return { error: `Canada Post could not return the label (${res.status}).` };
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_PDF_BYTES || bytes.subarray(0, 5).toString('latin1') !== '%PDF-') return { error: 'Canada Post did not return a PDF for this label.' };
  return { bytes };
}

async function fetchLabelPdf(order, deps = {}) {
  const d = { fetchImpl: fetch, env: process.env, ...deps };
  if (order?.label?.status !== 'created') throw new LabelError('no-label', 'There is no label for this order.', 404);
  const filename = `label-${text(order.orderNumber).replace(/[^A-Za-z0-9_-]/g, '')}.pdf`;
  const stored = trustedShippingLink(order.label.artifactUrl);
  const first = stored ? await downloadPdf(stored, d) : null;
  if (first?.bytes) return { bytes: first.bytes, filename };
  // No stored link, or it no longer works (label links can expire): ask Canada Post for the shipment's current one, once.
  const number = customerNumber(d.env);
  if (!number || !order.label.shipmentId) {
    if (first) throw new LabelError('pdf-failed', first.error, 502);
    throw new LabelError('no-label-link', 'The label link is missing; use "Check with Canada Post".', 409);
  }
  const res = await authorizedGet(`${SHIPPING_URL}/${number}/${number}/shipments/${encodeURIComponent(order.label.shipmentId)}`, { accept: 'application/json', env: d.env, fetchImpl: d.fetchImpl, label: 'Canada Post shipment lookup' });
  if (!res.ok) throw new LabelError('lookup-failed', `Canada Post could not return the label link (${res.status}).`, 502);
  let body = null;
  try { body = await res.json(); } catch { /* no link below */ }
  const url = pickLabelLink(body?.links);
  if (!url) {
    console.error(`Canada Post returned no usable label link for order ${order.orderNumber}: ${(Array.isArray(body?.links) ? body.links : []).map((l) => { try { return new URL(String(l?.href).replace(/^["'\s]+/, ''), SHIPPING_URL).host; } catch { return 'unparseable'; } }).join(', ') || 'no links'}`);
    throw new LabelError('no-label-link', 'Canada Post did not return a label link this site can use. Open the label from Canada Post\'s Shipping tools; the tracking number is on the order.', 502);
  }
  const second = await downloadPdf(url, d);
  if (!second.bytes) throw new LabelError('pdf-failed', second.error, 502);
  return { bytes: second.bytes, filename };
}

// What the admin screens may see of a label: no Canada Post URLs, no card details beyond the type.
function labelView(label) {
  if (!label?.status) return null;
  return {
    status: label.status,
    serviceName: label.serviceName || null,
    serviceCode: label.serviceCode || null,
    signature: Boolean(label.signature),
    trackingPin: label.trackingPin || null,
    shipmentId: label.shipmentId || null,
    price: label.price ? { preTax: label.price.preTax ?? null, tax: label.price.tax ?? null, due: label.price.due ?? null, charged: label.price.charged ?? null } : null,
    cardType: label.cardType || null,
    createdAt: label.createdAt || null,
    claimedAt: label.claimedAt || null,
    error: label.error ? { code: label.error.code || '', message: label.error.message || '' } : null,
  };
}

module.exports = {
  LabelError,
  SERVICES,
  labelsEnabled,
  maxDue,
  dailyLimit,
  senderFromEnv,
  destinationFromOrder,
  parcelForOrder,
  recommendedService,
  labelEligibility,
  normalizeQuote,
  quoteLabelOptions,
  buildShipmentRequest,
  trustedShippingLink,
  pickLabelLink,
  parseShipment,
  buyLabel,
  reconcileLabel,
  releaseLabel,
  fetchLabelPdf,
  labelView,
  STALE_CLAIM_MS,
};

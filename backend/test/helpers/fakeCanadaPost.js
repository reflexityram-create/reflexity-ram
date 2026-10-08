// A stand-in for api.canadapost-postescanada.ca, shaped by the published Shipping 8.0 / Rating specs (request and
// response examples included: a bare array of links for the shipment search, "mediaType" on links, 200 on create).
// The prices are what Canada Post really quoted on 2026-10-08 for a 0.4 kg parcel from Scarborough (M1P) to Winnipeg
// (R3W) at our commercial rate: Expedited Parcel 19.16, Regular Parcel 19.16, Xpresspost 24.13, Priority 57.69, each
// with GST. Only Expedited Parcel's adjustments are verbatim (SMB savings -3.94, fuel surcharge +5.48); for the others
// the base and the amount due are real and the two adjustments are split so that they add up to it.
const canadaPost = require('../../src/utils/canadaPost');

const BASE = canadaPost.BASE;
const SHIPPING = `${BASE}/shipping/v1`;
const NUMBER = '0000000001';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const cents = (n) => Math.round(n * 100) / 100;

// service: [serviceName, base, adjustments (sum), transit days, guaranteed, arrives, price of the Signature option]
// (Signature costs $2.00 before tax on the parcel services and Xpresspost and nothing on Priority, as the live API answered.)
const SERVICES = {
  'DOM.EP': ['Expedited Parcel', 16.71, [['V1DISC', -3.94], ['FUELSC', 5.48]], 3, true, '2026-10-14', 2],
  'DOM.RP': ['Regular Parcel', 16.71, [['V1DISC', -3.94], ['FUELSC', 5.48]], 4, false, '2026-10-15', 2],
  'DOM.XP': ['Xpresspost', 18.43, [['V1DISC', -4.31], ['FUELSC', 8.86]], 2, true, '2026-10-13', 2],
  'DOM.PC': ['Priority', 47.04, [['V1DISC', -8.59], ['FUELSC', 16.49]], 1, true, '2026-10-09', 0],
};

function quoteFor(code, signature) {
  const [serviceName, base, adjustments, days, guaranteed, arrives, signaturePrice] = SERVICES[code];
  const options = [{ optionCode: 'DC', optionName: 'Delivery confirmation', optionPrice: 0, qualifier: { included: true } }];
  if (signature) options.push({ optionCode: 'SO', optionName: 'Signature', optionPrice: signaturePrice });
  const preTax = cents(base + adjustments.reduce((s, [, v]) => s + v, 0) + (signature ? signaturePrice : 0));
  const gst = cents(preTax * 0.05);
  return {
    serviceCode: code,
    serviceName,
    priceDetails: {
      base,
      taxes: { gst: { amt: gst, percent: 5 }, pst: { amt: 0, percent: 0 }, hst: { amt: 0, percent: 0 } },
      due: cents(preTax + gst),
      options,
      adjustments: adjustments.map(([adjustmentCode, adjustmentCost]) => ({ adjustmentCode, adjustmentName: adjustmentCode, adjustmentCost })),
    },
    serviceStandard: { amDelivery: false, guaranteedDelivery: guaranteed, expectedTransitTime: days, expectedDeliveryDate: arrives },
  };
}

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'latin1');

// scenario.create: 'ok' | 'reject' | 'server-error' | 'network' | 'hang' | 'duplicate' | 'no-pin' | 'unreadable' | 'suspended'
// (scenario.processedAnyway = true: a server-error or network failure after which Canada Post nevertheless holds the shipment)
function fakeCanadaPost(scenario = {}) {
  const calls = [];
  const seenRequestIds = new Set(); // Canada Post refuses a second shipment with the same customerRequestId
  const s = {
    create: 'ok',
    rating: 'ok',
    lookup: 'found', // GET shipments?request-id=...: 'found' | 'none' | 'not-found' | 'error' | 'accepted' | 'wrapped' | 'garbled'
    access: 'ok', // the no-manifest probe: 'ok' | 'unauthorized' | 'forbidden' | 'error'
    pin: '123456789012',
    shipmentId: 'ship-001',
    artifactHref: `${SHIPPING}/artifacts/consumer-1/shipping/artifact-1/0`,
    pdf: PDF,
    ...scenario,
  };
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET';
    let body = null;
    try { body = init.body ? JSON.parse(init.body) : null; } catch { body = init.body; } // the token request is form-encoded
    const call = { method, url: String(url), body, headers: { ...(init.headers || {}) } };
    calls.push(call);
    const u = String(url);
    if (u.endsWith('/oauth2/token')) return json({ access_token: 'test-token', expires_in: 3600 });
    if (init.headers?.Authorization !== 'Bearer test-token') return json({ errors: [{ errorCode: '401', message: 'unauthorized' }] }, 401);
    if (u === `${BASE}/rating/v1/prices`) {
      if (s.rating === 'error') return json({ title: 'Validation failed', errors: [{ errorCode: '8551', message: 'bad request' }] }, 400);
      if (s.rating === 'empty') return json([]);
      if (s.rating === 'signature-error' && body.options?.length) return json({ title: 'Validation failed', errors: [{ errorCode: '8551', message: 'option not allowed' }] }, 400);
      const wanted = body.services?.length ? body.services : Object.keys(SERVICES);
      const signature = Boolean(body.options?.some((o) => o.optionCode === 'SO'));
      const shift = Number(s.ratingShift) || 0; // a price that moved since the picker was shown
      return json(wanted.filter((code) => SERVICES[code]).map((code) => {
        const quote = quoteFor(code, signature);
        if (shift) quote.priceDetails.due = cents(quote.priceDetails.due + shift);
        return quote;
      }));
    }
    if (u === `${SHIPPING}/${NUMBER}/${NUMBER}/shipments` && method === 'POST') {
      call.create = true;
      if (s.create === 'reject') return json({ errors: [{ errorCode: '9111', message: 'Service not available' }] }, 400);
      if (s.create === 'duplicate' || seenRequestIds.has(body.customerRequestId)) {
        return json({ errors: [{ errorCode: '002', message: 'Duplicate request id: customerRequestId must be unique' }] }, 400);
      }
      // From here on Canada Post has the shipment, whatever the caller gets to see: `processedAnyway` models the failures
      // where the answer is lost but the label (and the charge) exist.
      if (!['server-error', 'network'].includes(s.create) || s.processedAnyway) seenRequestIds.add(body.customerRequestId);
      if (s.create === 'network') throw new TypeError('fetch failed');
      if (s.create === 'server-error') return json({ errors: [{ errorCode: '9999', message: 'internal error' }] }, 500);
      if (s.create === 'hang') return new Promise(() => {}); // never answers
      if (s.create === 'unreadable') return new Response('<html>gateway</html>', { status: 200 });
      return json({
        customerRequestId: body.customerRequestId,
        shipmentId: s.shipmentId,
        shipmentStatus: s.create === 'suspended' ? 'suspended' : 'created',
        ...(s.create === 'no-pin' ? {} : { trackingPin: s.pin }),
        shipmentPrice: {
          serviceCode: body.deliverySpec.serviceCode,
          dueAmount: s.charged ?? cents(quoteFor(body.deliverySpec.serviceCode, Boolean(body.deliverySpec.options)).priceDetails.due + (Number(s.ratingShift) || 0)),
        },
        shipmentReceipt: { ccReceiptDetails: { cardType: 'VI', nameOnCard: 'Test Cardholder', authCode: '123456', chargeAmount: 19.16, currency: 'CAD' } },
        links: [
          { rel: 'self', href: `${SHIPPING}/${NUMBER}/${NUMBER}/shipments/${s.shipmentId}`, mediaType: 'application/json' },
          { rel: 'returnLabel', href: `${SHIPPING}/artifacts/consumer-1/shipping/return-1/0`, mediaType: 'application/pdf' },
          { rel: 'label', href: s.artifactHref, mediaType: 'application/pdf' },
        ],
      });
    }
    if (u.startsWith(`${SHIPPING}/${NUMBER}/${NUMBER}/shipments?`)) {
      const query = new URL(u).searchParams;
      // The access probe: today's no-manifest shipments (what the admin screen asks before offering a purchase).
      if (query.has('no-manifest') && !query.has('request-id')) {
        call.access = true;
        if (s.access === 'unauthorized') return json({ errors: [{ errorCode: '401', message: 'API product not subscribed' }] }, 401);
        if (s.access === 'forbidden') return json({ errors: [{ errorCode: '403', message: 'forbidden' }] }, 403);
        if (s.access === 'error') return json({ errors: [{ errorCode: '9000', message: 'try later' }] }, 503);
        return json([]);
      }
      call.lookup = true;
      // Live behaviour (2026-10-08): the request id is the whole search; anything added to it is a 400.
      if (query.has('request-id') && query.has('no-manifest')) return json({ title: 'Validation failed', errors: [{ errorCode: '9183', message: 'Mutually exclusive search parameters were provided.  Please refer to documentation and provide only one.' }] }, 400);
      if (query.has('request-id') && (query.has('date') || query.has('limit'))) return json({ title: 'Validation failed', errors: [{ errorCode: '9185', message: 'Limit and/or Date do not apply to this type of request.' }] }, 400);
      const links = [{ rel: 'shipment', href: `${SHIPPING}/${NUMBER}/${NUMBER}/shipments/${s.shipmentId}`, mediaType: 'application/json' }];
      if (s.lookup === 'error') return json({ errors: [{ errorCode: '9000', message: 'try later' }] }, 503);
      if (s.lookup === 'accepted') return new Response(null, { status: 202 });
      if (s.lookup === 'not-found') return json({ errors: [{ errorCode: '404', message: 'No shipments found' }] }, 404);
      if (s.lookup === 'garbled') return new Response('<html>gateway</html>', { status: 200 });
      if (s.lookup === 'none') return json([]);
      if (s.lookup === 'wrapped') return json({ links });
      return json(links);
    }
    if (u === `${SHIPPING}/${NUMBER}/${NUMBER}/shipments/${s.shipmentId}`) {
      return json({ shipmentId: s.shipmentId, shipmentStatus: 'transmitted', trackingPin: s.pin, links: [{ rel: 'label', href: s.artifactHref, mediaType: 'application/pdf' }] });
    }
    if (u === s.artifactHref) return new Response(s.pdf, { status: 200, headers: { 'content-type': 'application/pdf' } });
    return json({ errors: [{ errorCode: '404', message: `no fake route for ${method} ${u}` }] }, 404);
  };
  return { fetchImpl, calls, scenario: s, seenRequestIds };
}

const labelEnv = (extra = {}) => ({
  CANADA_POST_API_KEY: 'test-key',
  CANADA_POST_API_SECRET: 'test-secret',
  CANADA_POST_CUSTOMER_NUMBER: NUMBER,
  CANADA_POST_LABELS_ENABLED: 'true',
  CANADA_POST_ORIGIN_POSTAL_CODE: 'M5H2N2',
  CANADA_POST_SENDER_NAME: 'Shipping Desk',
  CANADA_POST_SENDER_COMPANY: 'Reflexity RAM',
  CANADA_POST_SENDER_PHONE: '416-555-0100',
  CANADA_POST_SENDER_ADDRESS1: '1 Example Street',
  CANADA_POST_SENDER_CITY: 'Toronto',
  CANADA_POST_SENDER_PROVINCE: 'ON',
  ...extra,
});

// A fictional buyer in Winnipeg: one stick, standard shipping, nothing special.
const labelOrder = (overrides = {}) => ({
  _id: 'order-1',
  orderNumber: 'RFX-TEST-000001',
  status: 'processing',
  paymentStatus: 'paid',
  items: [{ name: 'SK hynix 16GB DDR4-3200 ECC RDIMM', sku: 'SKU-1', qty: 1, price: 135 }],
  shippingAddress: { firstName: 'Pat', lastName: 'Example', line1: '123 Example Avenue', city: 'Winnipeg', state: 'MB', zip: 'R3W 1A1', country: 'CA', phone: '204-555-0100' },
  shippingMethod: 'Flat-Rate Shipping (delivery 3–6 business days after dispatch)',
  shippingCost: 14,
  adminNotes: '',
  ...overrides,
});

module.exports = { fakeCanadaPost, labelEnv, labelOrder, quoteFor, SHIPPING, NUMBER, PDF, BASE };

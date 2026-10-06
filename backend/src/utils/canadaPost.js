// ─── Canada Post developer API (OAuth 2.0, REST) ───────────────────────────────
// App "[Production] Reflexity RAM website" on the Canada Post developer portal,
// subscribed to Tracking 2.0.0 and Rating 4.0.0. Credentials come from
// CANADA_POST_API_KEY / CANADA_POST_API_SECRET; tokens last an hour and are
// cached in memory.

const BASE = 'https://api.canadapost-postescanada.ca/prod/devportal-portaildesdeveloppeurs';
const TOKEN_URL = `${BASE}/cpc-api-native-oauth-provider/oauth2/token`;
const TRACKING_URL = `${BASE}/tracking/v1`;
const RATING_URL = `${BASE}/rating/v1`;

const isConfigured = () => Boolean(process.env.CANADA_POST_API_KEY && process.env.CANADA_POST_API_SECRET);

let cachedToken = null;
let pendingToken = null; // shared by lookups that start together

const requestToken = async (fetchImpl) => {
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: {
      'X-IBM-Client-Id': process.env.CANADA_POST_API_KEY,
      'X-IBM-Client-Secret': process.env.CANADA_POST_API_SECRET,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'scope=merchant&grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Canada Post token request failed (${res.status})`);
  const body = await res.json();
  // Refresh a minute early so a token never expires mid-request.
  cachedToken = { token: body.access_token, expiresAt: Date.now() + (Number(body.expires_in || 3600) - 60) * 1000 };
  return cachedToken.token;
};

const accessToken = async (fetchImpl = fetch) => {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  if (!pendingToken) pendingToken = requestToken(fetchImpl).finally(() => { pendingToken = null; });
  return pendingToken;
};

const getJson = async (url, fetchImpl) => {
  const res = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${await accessToken(fetchImpl)}`, Accept: 'application/json', 'Accept-Language': 'en-CA' },
  });
  if (!res.ok) throw new Error(`Canada Post tracking request failed (${res.status})`);
  return res.json();
};

// Event codes seen on real parcels: 0174 "Item out for delivery", 14xx
// "Delivered ...". Descriptions are matched too, because codes vary by service.
const OUT_FOR_DELIVERY = /out for delivery/i;
const READY_FOR_PICKUP = /notice card|available for pick ?up|ready for pick ?up|pick up at/i;

// Turns Canada Post's summary + details into what the store needs.
const normalizeTracking = (summary = {}, details = {}) => {
  const events = Array.isArray(details.significantEvents) ? details.significantEvents : [];
  // Newest first. "Photo available" is logged with the delivery scan; the
  // delivery itself is the useful line for the buyer.
  const latest = events.find((e) => !/photo available/i.test(e.eventDescription || '')) || events[0];
  const delivered = Boolean(summary.actualDeliveryDate);
  const isOut = (e) => e && (e.eventIdentifier === '0174' || OUT_FOR_DELIVERY.test(e.eventDescription || ''));
  return {
    delivered,
    deliveredOn: summary.actualDeliveryDate || null,
    expectedDeliveryDate: details.changedExpectedDate || details.expectedDeliveryDate || summary.expectedDeliveryDate || null,
    outForDelivery: !delivered && isOut(latest),
    readyForPickup: !delivered && Boolean(latest && READY_FOR_PICKUP.test(latest.eventDescription || '')),
    latest: latest
      ? {
        code: latest.eventIdentifier || '',
        description: latest.eventDescription || '',
        date: latest.eventDate || '',
        time: latest.eventTime || '',
        timeZone: latest.eventTimeZone || '',
        location: [latest.eventSite, latest.eventProvince].filter(Boolean).join(', '),
      }
      : summary.eventDescription
        ? { code: '', description: summary.eventDescription, date: '', time: '', timeZone: '', location: summary.eventLocation || '' }
        : null,
  };
};

const trackParcel = async (pin, fetchImpl = fetch) => {
  const clean = String(pin || '').replace(/\s+/g, '');
  if (!clean) throw new Error('No tracking number');
  const encoded = encodeURIComponent(clean);
  const [summaries, details] = await Promise.all([
    getJson(`${TRACKING_URL}/pins/${encoded}/summaries`, fetchImpl),
    getJson(`${TRACKING_URL}/pins/${encoded}/details`, fetchImpl),
  ]);
  return normalizeTracking(Array.isArray(summaries) ? summaries[0] : summaries, details);
};

// Live prices for a parcel to another country. With CANADA_POST_CUSTOMER_NUMBER
// set, Canada Post returns the account's discounted (commercial) price.
const rateInternational = async ({ countryCode, parcel, originPostalCode, fetchImpl = fetch }) => {
  const customerNumber = process.env.CANADA_POST_CUSTOMER_NUMBER;
  const res = await fetchImpl(`${RATING_URL}/prices`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await accessToken(fetchImpl)}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Accept-Language': 'en-CA',
    },
    body: JSON.stringify({
      quoteType: customerNumber ? 'commercial' : 'counter',
      ...(customerNumber ? { customerNumber } : {}),
      parcelCharacteristics: parcel,
      originPostalCode,
      destination: { international: { countryCode } },
    }),
  });
  if (!res.ok) throw new Error(`Canada Post rating request failed (${res.status})`);
  const quotes = await res.json();
  return (Array.isArray(quotes) ? quotes : []).map((q) => ({
    serviceCode: q.serviceCode,
    serviceName: q.serviceName,
    price: Number(q.priceDetails?.due),
    transitDays: q.serviceStandard?.expectedTransitTime ?? null,
    guaranteed: Boolean(q.serviceStandard?.guaranteedDelivery),
  }));
};

// Live prices for a parcel inside Canada. Taxes are taken out of Canada Post's `due`: Stripe Tax adds the buyer's tax to our
// shipping charge, so passing the tax-inclusive amount on would tax it twice. The quote asks for the Signature option (SO) so
// its price is known: `price` includes it and `signaturePrice` is what it adds (null when Canada Post did not price it).
const rateDomestic = async ({ postalCode, parcel, originPostalCode, services, fetchImpl = fetch }) => {
  const customerNumber = process.env.CANADA_POST_CUSTOMER_NUMBER;
  const res = await fetchImpl(`${RATING_URL}/prices`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await accessToken(fetchImpl)}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Accept-Language': 'en-CA',
    },
    body: JSON.stringify({
      quoteType: customerNumber ? 'commercial' : 'counter',
      ...(customerNumber ? { customerNumber } : {}),
      parcelCharacteristics: parcel,
      originPostalCode,
      destination: { domestic: { postalCode } },
      ...(services?.length ? { services } : {}),
      options: [{ optionCode: 'SO' }],
    }),
  });
  if (!res.ok) throw new Error(`Canada Post rating request failed (${res.status})`);
  const quotes = await res.json();
  return (Array.isArray(quotes) ? quotes : []).map((q) => {
    const details = q.priceDetails || {};
    const taxes = ['gst', 'pst', 'hst'].reduce((sum, key) => sum + (Number(details.taxes?.[key]?.amt) || 0), 0);
    const signature = (details.options || []).find((option) => option.optionCode === 'SO');
    return {
      serviceCode: q.serviceCode,
      serviceName: q.serviceName,
      price: Math.round((Number(details.due) - taxes) * 100) / 100,
      signaturePrice: signature && Number.isFinite(Number(signature.optionPrice)) ? Number(signature.optionPrice) : null,
      transitDays: q.serviceStandard?.expectedTransitTime ?? null,
      guaranteed: Boolean(q.serviceStandard?.guaranteedDelivery),
    };
  });
};

const resetTokenCacheForTest = () => { cachedToken = null; pendingToken = null; };

module.exports = { isConfigured, accessToken, trackParcel, normalizeTracking, rateInternational, rateDomestic, resetTokenCacheForTest, BASE };

// ─── Canada Post developer API (OAuth 2.0, REST) ───────────────────────────────
// App "[Production] Reflexity RAM website" on the Canada Post developer portal,
// subscribed to Tracking 2.0.0, Rating 4.0.0 and (since 2026-10-08, for the admin
// label purchase in canadaPostLabels.js) Shipping 8.0.0. Credentials come from
// CANADA_POST_API_KEY / CANADA_POST_API_SECRET; tokens last an hour and are
// cached in memory.

const BASE = 'https://api.canadapost-postescanada.ca/prod/devportal-portaildesdeveloppeurs';
const TOKEN_URL = `${BASE}/cpc-api-native-oauth-provider/oauth2/token`;
const TRACKING_URL = `${BASE}/tracking/v1`;
const RATING_URL = `${BASE}/rating/v1`;

const isConfigured = () => Boolean(process.env.CANADA_POST_API_KEY && process.env.CANADA_POST_API_SECRET);

let cachedToken = null;
let pendingToken = null; // shared by lookups that start together

// A Canada Post answer that never comes must not hang a buyer's checkout (or every lookup waiting on the shared token
// request). One deadline covers the request and its body; the race ends the wait even when fetch ignores the abort signal.
const REQUEST_TIMEOUT_MS = 20 * 1000;
const withDeadline = async (run, label, ms = REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error(`${label} timed out`)); }, ms);
  });
  const work = run(controller.signal);
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
    work.catch(() => {}); // a failure that lands after the deadline is not an unhandled rejection
  }
};

const requestToken = async (fetchImpl) => {
  const body = await withDeadline(async (signal) => {
    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: {
        'X-IBM-Client-Id': process.env.CANADA_POST_API_KEY,
        'X-IBM-Client-Secret': process.env.CANADA_POST_API_SECRET,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'scope=merchant&grant_type=client_credentials',
      signal,
    });
    if (!res.ok) throw new Error(`Canada Post token request failed (${res.status})`);
    return res.json();
  }, 'Canada Post token request');
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
  const token = await accessToken(fetchImpl);
  return withDeadline(async (signal) => {
    const res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Accept-Language': 'en-CA' }, signal,
    });
    if (!res.ok) throw new Error(`Canada Post tracking request failed (${res.status})`);
    return res.json();
  }, 'Canada Post tracking request');
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
  // A label or electronic declaration is not proof the parcel was handed over.
  const physicalScan = (e) => e && !/electronic|label|information submitted|shipping details|expected/i.test(e.eventDescription || '')
    && (['1302', '0174', '1701', '1421'].includes(e.eventIdentifier)
      || /\b(item|shipment|parcel) (accepted|processed|picked up|arrived|departed|in transit|out for delivery|delivered)\b/i.test(e.eventDescription || '')
      || READY_FOR_PICKUP.test(e.eventDescription || ''));
  const accepted = [...events].reverse().find(physicalScan);
  const summaryPhysical = physicalScan(summary);

  const isOut = (e) => e && (e.eventIdentifier === '0174' || OUT_FOR_DELIVERY.test(e.eventDescription || ''));
  return {
    hasShipped: delivered || Boolean(accepted) || summaryPhysical,
    shippedOn: accepted?.eventDate || (summaryPhysical ? summary.eventDate : null) || summary.actualDeliveryDate || null,
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

// Live prices for a parcel to another country (`destination` is Canada Post's own shape:
// { international: { countryCode } } or { unitedStates: { zipCode } }). With
// CANADA_POST_CUSTOMER_NUMBER set, Canada Post returns the account's discounted
// (commercial) price.
const ratePrices = async ({ destination, parcel, originPostalCode, fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS }) => {
  const customerNumber = process.env.CANADA_POST_CUSTOMER_NUMBER;
  const token = await accessToken(fetchImpl);
  const quotes = await withDeadline(async (signal) => {
    const res = await fetchImpl(`${RATING_URL}/prices`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Accept-Language': 'en-CA',
      },
      body: JSON.stringify({
        quoteType: customerNumber ? 'commercial' : 'counter',
        ...(customerNumber ? { customerNumber } : {}),
        parcelCharacteristics: parcel,
        originPostalCode,
        destination,
      }),
      signal,
    });
    if (!res.ok) throw new Error(`Canada Post rating request failed (${res.status})`);
    return res.json();
  }, 'Canada Post rating request', timeoutMs);
  return (Array.isArray(quotes) ? quotes : []).map((q) => ({
    serviceCode: q.serviceCode,
    serviceName: q.serviceName,
    price: Number(q.priceDetails?.due),
    transitDays: q.serviceStandard?.expectedTransitTime ?? null,
    guaranteed: Boolean(q.serviceStandard?.guaranteedDelivery),
  }));
};

const rateInternational = ({ countryCode, ...rest }) => ratePrices({ ...rest, destination: { international: { countryCode } } });
const rateUnitedStates = ({ zipCode, ...rest }) => ratePrices({ ...rest, destination: { unitedStates: { zipCode } } });

const resetTokenCacheForTest = () => { cachedToken = null; pendingToken = null; };

module.exports = { isConfigured, accessToken, trackParcel, normalizeTracking, rateInternational, rateUnitedStates, resetTokenCacheForTest, BASE, withDeadline, REQUEST_TIMEOUT_MS };

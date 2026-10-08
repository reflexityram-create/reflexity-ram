// The rules behind the admin "Canada Post label" panel, kept apart from the component so they can be tested without a
// browser. Nothing here talks to the network and nothing here decides to buy: a purchase only ever starts from the
// confirm button in components/admin/LabelPanel.jsx, with the request built by purchaseRequest() from the exact option
// and price the admin was looking at.

export const money = (value) => `$${Number(value || 0).toFixed(2)}`;

const ACTIONABLE_REFUSALS = new Set(['outside-canada', 'bad-address', 'odd-parcel', 'not-configured', 'has-tracking']);

// Which screen the panel shows, from what the server sent (order.label and order.labelEligibility) and nothing else.
export function labelStage(order) {
  const label = order?.label;
  const eligibility = order?.labelEligibility;
  if (label?.status === 'created') return 'bought';
  if (label?.status === 'unknown' || eligibility?.code === 'unknown-outcome') return 'unfinished';
  if (label?.status === 'creating' || eligibility?.code === 'in-progress') return 'running';
  if (eligibility?.canQuote) return eligibility.canBuy ? 'ready' : 'switched-off';
  return 'unavailable';
}

// The panel stays out of the way of orders it has nothing to say about (unpaid, shipped, cancelled...).
export function panelVisible(order) {
  const stage = labelStage(order);
  if (stage !== 'unavailable') return true;
  return ACTIONABLE_REFUSALS.has(order?.labelEligibility?.code);
}

// The price of an option as it will be bought: with or without the signature. null when that variant is not offered.
export function priceOf(option, signature) {
  if (!option) return null;
  if (!signature) return option.due;
  return option.withSignature ? option.withSignature.due : null;
}

export function detailsOf(option, signature) {
  if (!option) return null;
  return signature ? option.withSignature : option;
}

// What the picker starts on: the service the buyer paid for, with the signature if they paid for it and it is offered.
export function initialChoice(payload) {
  const options = payload?.options || [];
  const wanted = payload?.recommended || {};
  const option = options.find((o) => o.serviceCode === wanted.serviceCode) || options[0];
  if (!option) return { serviceCode: null, signature: false };
  return { serviceCode: option.serviceCode, signature: Boolean(wanted.signature) && Boolean(option.withSignature) };
}

// The one request a purchase sends: exactly the option and the price on screen, flagged as approved.
export function purchaseRequest(option, signature) {
  const approvedDue = priceOf(option, Boolean(signature));
  if (!option || !Number.isFinite(approvedDue) || approvedDue <= 0) return null;
  return { serviceCode: option.serviceCode, signature: Boolean(signature), approvedDue, approve: true };
}

// What the signature option adds to the price: "" when it is not offered, "included" when it costs nothing extra (Priority).
export function signatureNote(option) {
  if (!option?.withSignature) return '';
  const extra = Math.round((option.withSignature.due - option.due) * 100) / 100;
  return extra > 0 ? `+${money(extra)}` : 'included';
}

// "3 days · guaranteed · arrives Wed, Oct 14" from a quote.
export function arrivalNote(details) {
  if (!details) return '';
  const parts = [];
  if (Number.isFinite(details.transitDays)) parts.push(`${details.transitDays} ${details.transitDays === 1 ? 'day' : 'days'}`);
  if (details.guaranteed) parts.push('guaranteed');
  const date = details.expectedDeliveryDate ? new Date(`${String(details.expectedDeliveryDate).slice(0, 10)}T12:00:00`) : null;
  if (date && !Number.isNaN(date.getTime())) parts.push(`arrives ${date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`);
  return parts.join(' · ');
}

// Puts a re-quoted price (sent back with a 409 "price-changed") into the options the admin is looking at.
export function withRequote(payload, quote, signature) {
  if (!payload || !quote?.serviceCode) return payload;
  return {
    ...payload,
    options: payload.options.map((option) => {
      if (option.serviceCode !== quote.serviceCode) return option;
      return signature ? { ...option, withSignature: quote } : { ...option, ...quote, withSignature: option.withSignature };
    }),
  };
}

// What an error from the purchase should do on screen. `reload` = the server's state may have changed (or is unknown),
// so read the order again instead of trusting the screen; `priceChanged` = show the new price and ask again.
export function explainPurchaseError(err) {
  const response = err?.response;
  if (!response) {
    return {
      message: 'No answer came back, so it is not known whether the label was bought. The order was reloaded: check its label status before trying again.',
      reload: true,
      priceChanged: null,
    };
  }
  const data = response.data || {};
  const message = typeof data.error === 'string' && data.error ? data.error : 'The purchase did not go through.';
  if (data.code === 'price-changed' && data.quote) return { message, reload: false, priceChanged: data.quote };
  const untouched = response.status === 400 || response.status === 401 || response.status === 403;
  return { message, reload: !untouched, priceChanged: null };
}

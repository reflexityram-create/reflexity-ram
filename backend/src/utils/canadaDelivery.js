const {
  FASTER_SHIPPING_LABEL,
  FASTER_SHIPPING_TRANSIT_DAYS,
  SIGNATURE_PRICE,
  SHIPPING_OPTIONS,
  resolveCartShippingPrice,
  resolveFasterShippingPrice,
} = require('../config/shipping');

// ─── Delivery inside Canada: the same two yes/no choices on every payment method ───
// A buyer picks Standard (the cart's flat rate), optionally Faster shipping (Xpresspost for a flat extra) and/or a
// signature on delivery. The browser only ever says yes or no; every price is worked out here from the cart.
// Card checkout (routes/stripe.js) and the e-Transfer order (routes/etransfer.js) both use this, so they cannot disagree.

class DeliveryChoiceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DeliveryChoiceError';
    this.status = 400;
    this.publicMessage = message;
  }
}

// `lines` is [{ product, qty }]; `requested` is the `shipping` object the browser sent.
// Returns the amount (dollars), the label shown to the buyer, and what the owner needs to know to make the label.
function resolveCanadaDelivery(lines, requested = {}) {
  // A page opened before the flat options went live still sends a postal code and a service.
  if (requested.serviceCode || requested.postalCode) {
    throw new DeliveryChoiceError('Delivery options were updated. Please reload the page and choose again.');
  }
  const faster = requested.faster === true;
  const signature = requested.signature === true;
  const standard = resolveCartShippingPrice(lines);
  if (!faster && !signature) {
    return { amount: standard, label: SHIPPING_OPTIONS.standard.label, faster: false, signature: false, choice: false, transitDays: null };
  }
  const fasterPrice = resolveFasterShippingPrice(lines);
  if (faster && fasterPrice === null) {
    throw new DeliveryChoiceError('Faster shipping is not offered on an order this size. Email us and we will arrange it.');
  }
  return {
    amount: (faster ? fasterPrice : standard) + (signature ? SIGNATURE_PRICE : 0),
    label: `${faster ? FASTER_SHIPPING_LABEL : SHIPPING_OPTIONS.standard.label}${signature ? ' + signature on delivery' : ''}`,
    faster,
    signature,
    choice: true,
    transitDays: faster ? FASTER_SHIPPING_TRANSIT_DAYS : null,
  };
}

// The metadata keys the fulfilment code (shippingChoiceNote) reads, for an order that did not come through Stripe.
const deliveryMetadata = (delivery) => (delivery.choice
  ? { shippingCountry: 'CA', canadaPostService: delivery.faster ? 'DOM.XP' : 'STANDARD', signature: delivery.signature ? 'yes' : 'no' }
  : {});

module.exports = { DeliveryChoiceError, resolveCanadaDelivery, deliveryMetadata };

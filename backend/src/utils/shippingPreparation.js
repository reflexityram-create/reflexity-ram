const Product = require('../models/Product');
const mongoose = require('mongoose');

const CANADA_POST_SNAP_SHIP_URL = 'https://www.canadapost-postescanada.ca/shippingtools-outilsexpedition/en/cart';

const text = (value) => (value == null ? '' : String(value).trim());

function serviceFromOrder(order) {
  const method = text(order?.shippingMethod);
  // shippingMethod is authoritative. adminNotes contains unrelated staff notes;
  // only parse the exact generated checkout note as a legacy fallback.
  const note = text(order?.adminNotes).split('\n').find((line) => /^SHIPPING: the buyer paid for ".*"\. When you make the label, .+\.$/.test(line));
  const generated = note?.match(/^SHIPPING: the buyer paid for "([^"]+)"\. When you make the label, (.+)\.$/);
  const source = method || generated?.[1] || '';
  const haystack = source.toLowerCase();
  const extras = generated?.[2] || '';
  const signature = /signature/.test(haystack) || /add the signature option/i.test(extras);
  // "buy <service>" in the generated note comes from the checkout metadata, i.e. from what the buyer actually chose. The stored label came from Stripe's
  // shipping rate, which was not expanded before 2026-10-06 and so read "Standard Shipping" on every order: the note outranks it.
  const bought = extras.match(/^buy (.+?)(?: and add the Signature option)?$/i)?.[1];
  let name = source || 'Shipping service not recorded';
  if (bought) name = bought;
  else if (/xpresspost/.test(haystack)) name = 'Xpresspost';
  else if (/expedited parcel/.test(haystack)) name = 'Expedited Parcel';
  else if (/standard/.test(haystack)) name = 'Standard';
  else if (/flat[- ]rate/.test(haystack)) name = 'Flat-rate shipping';           // the checkout's own label: "Flat-Rate Shipping (delivery 3–6 business days after dispatch)"
  else name = name.replace(/\s*\+\s*signature on delivery\s*$/i, '');           // the panel adds "+ signature" itself
  return { name, recordedMethod: method || null, signature };
}

function fulfilmentState(order) {
  if (order?.status === 'shipped' || order?.status === 'delivered') {
    return { canCreateLabel: false, reason: 'This order is already shipped.' };
  }
  if (order?.status === 'cancelled' || order?.status === 'refunded' || order?.paymentStatus === 'refunded') {
    return { canCreateLabel: false, reason: 'This order is cancelled or refunded.' };
  }
  if (order?.paymentStatus !== 'paid') {
    return { canCreateLabel: false, reason: 'A label should only be created after payment is confirmed.' };
  }
  return { canCreateLabel: true, reason: null };
}

function addressForOrder(value) {
  const address = value || {};
  return {
    fullName: [address.firstName, address.lastName].filter(Boolean).join(' '),
    line1: text(address.line1),
    line2: text(address.line2) || null,
    city: text(address.city),
    state: text(address.state),
    postalCode: text(address.zip),
    country: text(address.country).toUpperCase(),
  };
}

function makeCopyText(preparation) {
  const address = preparation.recipient;
  const lines = [
    preparation.service.signature ? `${preparation.service.name} + signature` : preparation.service.name,
    address.fullName,
    address.line1,
    address.line2,
    [address.city, address.state, address.postalCode].filter(Boolean).join(', '),
    address.country,
  ].filter(Boolean);
  if (preparation.customs.required) {
    lines.push('', 'Customs');
    preparation.customs.lines.forEach((line) => {
      const origin = line.countryOfOrigin || 'ORIGIN MISSING';
      const hs = line.hsCode || 'HS CODE MISSING';
      lines.push(`${line.qty} × ${line.name} | CAD $${line.unitValueCAD.toFixed(2)} each | origin ${origin} | HS ${hs}`);
    });
  }
  if (preparation.duties) {
    lines.push('', `US import duties and fees prepaid by the buyer: CAD $${preparation.duties.prepaidCAD.toFixed(2)} (Zonos pays US Customs when the label is made)`);
  }
  return lines.join('\n');
}

async function buildShippingPreparation(order, ProductModel = Product) {
  const items = (Array.isArray(order?.items) ? order.items : []).filter(Boolean);
  const linkedIds = [...new Set(items.map((item) => item.product || item.productObjectID).filter(Boolean).map(String))]
    .filter((id) => mongoose.Types.ObjectId.isValid(id));
  const legacySkus = [...new Set(items.filter((item) => !(item.product || item.productObjectID))
    .map((item) => text(item.sku).toUpperCase()).filter(Boolean))];
  const query = (filter) => ProductModel.find(filter).select('_id sku countryOfOrigin hsCode isActive').lean();
  const [linkedProducts, legacyProducts] = await Promise.all([
    linkedIds.length ? query({ _id: { $in: linkedIds } }) : [],
    legacySkus.length ? query({ sku: { $in: legacySkus } }) : [],
  ]);
  const byId = new Map(linkedProducts.map((product) => [String(product._id), product]));
  const bySku = new Map(legacyProducts.map((product) => [text(product.sku).toUpperCase(), product]));
  const country = text(order?.shippingAddress?.country).toUpperCase();
  const international = Boolean(country && country !== 'CA');
  const customsLines = items.map((item) => {
    const sku = text(item.sku).toUpperCase();
    const linkedId = item.product || item.productObjectID;
    const product = linkedId ? byId.get(String(linkedId)) : bySku.get(sku);
    const origin = text(product?.countryOfOrigin).toUpperCase() || null;
    const hsCode = text(product?.hsCode) || null;
    return {
      sku: text(item.sku),
      name: text(item.name),
      qty: Number(item.qty) || 0,
      unitValueCAD: Number(item.price) || 0,
      countryOfOrigin: origin,
      hsCode,
      productId: linkedId ? String(linkedId) : (product?._id ? String(product._id) : null),
      productFound: Boolean(product),
      productActive: product ? product.isActive !== false : false,
      missingOrigin: !origin,
      missingHsCode: !hsCode,
    };
  });
  const result = {
    fulfillment: fulfilmentState(order),
    service: serviceFromOrder(order),
    recipient: addressForOrder(order?.shippingAddress),
    customs: { required: international, lines: international ? customsLines : [] },
    // US orders: the part of the shipping charge that is prepaid import duties (the buyer reimbursed it; Zonos bills the owner's card at the label).
    duties: Number(order?.importDuties) > 0
      ? { prepaidCAD: Math.round(Number(order.importDuties) * 100) / 100, quoteId: text(order.importDutiesQuoteId) || null }
      : null,
    links: { snapShip: CANADA_POST_SNAP_SHIP_URL },
    items: customsLines.map(({ sku, name, qty, unitValueCAD, productId, productFound, productActive }) => ({
      sku, name, qty, unitValueCAD, productId, productFound, productActive,
    })),
  };
  if (international && result.fulfillment.canCreateLabel) {
    const incomplete = customsLines.length === 0 || customsLines.some((line) => line.missingOrigin || line.missingHsCode || !line.productFound);
    if (incomplete) {
      result.fulfillment = {
        canCreateLabel: false,
        state: 'blocked_missing_customs',
        reason: customsLines.length === 0
          ? 'This international order has no items to declare on a customs form.'
          : 'Add the saved country of origin and HS code for every product before creating an international label.',
      };
    }
  }
  result.copyText = makeCopyText(result);
  return result;
}

module.exports = {
  CANADA_POST_SNAP_SHIP_URL,
  buildShippingPreparation,
  fulfilmentState,
  serviceFromOrder,
};

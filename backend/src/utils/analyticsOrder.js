// The purchase as GA4 wants it. Google's rule for `value`: the sum of price × quantity over the items, without shipping or
// tax (they have their own fields), and an item that is discounted carries its discounted unit price (the unit discount goes
// in `discount`). `value` used to be the order total, so every purchase counted its shipping (and any US duties) as revenue.
// The order's discount (a coupon, the bank-debit or e-Transfer saving) is spread over the items by value. `value` is exact
// (goods less discount, to the cent); each item's unit price is rounded to the cent, so on an odd discount the items can
// add up to a cent or two more or less than `value`: the revenue figure is the one kept exact.
const cents = (amount) => Math.round(Number(amount || 0) * 100);

function analyticsOrder(order, currency = 'cad') {
  const items = order.items || [];
  const quantity = (item) => Number(item.qty || 1);
  const goodsCents = items.reduce((sum, item) => sum + cents(item.price) * quantity(item), 0);
  const discountCents = Math.min(Math.max(cents(order.discount), 0), goodsCents);
  const lines = items.map((item) => {
    const unitCents = cents(item.price);
    const unitDiscountCents = goodsCents > 0 ? Math.round((unitCents * discountCents) / goodsCents) : 0;
    return { item, priceCents: unitCents - unitDiscountCents, unitDiscountCents };
  });
  return {
    currency: String(currency || 'cad').toUpperCase(),
    value: (goodsCents - discountCents) / 100,
    tax: Number(order.tax || 0),
    shipping: Number(order.shippingCost || 0),
    items: lines.map(({ item, priceCents, unitDiscountCents }) => ({
      item_id: item.sku || item.slug,
      item_name: item.name,
      price: priceCents / 100,
      ...(unitDiscountCents > 0 ? { discount: unitDiscountCents / 100 } : {}),
      quantity: quantity(item),
    })),
  };
}

module.exports = { analyticsOrder };

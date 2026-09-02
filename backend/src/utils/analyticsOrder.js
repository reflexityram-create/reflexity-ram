function analyticsOrder(order, currency = 'cad') {
  return {
    currency: String(currency || 'cad').toUpperCase(),
    value: Number(order.total || 0),
    tax: Number(order.tax || 0),
    shipping: Number(order.shippingCost || 0),
    items: (order.items || []).map((item) => ({
      item_id: item.sku || item.slug,
      item_name: item.name,
      price: Number(item.price || 0),
      quantity: Number(item.qty || 1),
    })),
  };
}

module.exports = { analyticsOrder };

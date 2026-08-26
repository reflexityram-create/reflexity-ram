const addressForCustomer = (address) => {
  if (!address) return undefined;
  const value = typeof address.toObject === 'function' ? address.toObject() : address;
  return {
    firstName: value.firstName,
    lastName: value.lastName,
    line1: value.line1,
    line2: value.line2,
    city: value.city,
    state: value.state,
    zip: value.zip,
    country: value.country,
    phone: value.phone,
  };
};

const itemForCustomer = (item) => {
  const value = typeof item.toObject === 'function' ? item.toObject() : item;
  return {
    slug: value.slug,
    sku: value.sku,
    name: value.name,
    price: value.price,
    image: value.image,
    qty: value.qty,
  };
};

/**
 * Explicit customer-facing order shape. Payment-provider identifiers,
 * inventory bookkeeping, archival flags, and admin-only notes never leave the
 * customer API even when new internal fields are added to the Mongoose model.
 */
const customerOrderResponse = (order) => {
  const value = typeof order?.toObject === 'function' ? order.toObject() : order;
  if (!value) return null;
  return {
    _id: value._id,
    orderNumber: value.orderNumber,
    user: value.user?.email ? { email: value.user.email } : undefined,
    guestEmail: value.guestEmail,
    items: Array.isArray(value.items) ? value.items.map(itemForCustomer) : [],
    shippingAddress: addressForCustomer(value.shippingAddress),
    status: value.status,
    paymentStatus: value.paymentStatus,
    subtotal: value.subtotal,
    shippingCost: value.shippingCost,
    tax: value.tax,
    discount: value.discount,
    total: value.total,
    shippingMethod: value.shippingMethod,
    trackingNumber: value.trackingNumber,
    trackingUrl: value.trackingUrl,
    estimatedDelivery: value.estimatedDelivery,
    shippedAt: value.shippedAt,
    deliveredAt: value.deliveredAt,
    cancelledAt: value.cancelledAt,
    statusHistory: Array.isArray(value.statusHistory)
      ? value.statusHistory.map((entry) => ({ status: entry.status, timestamp: entry.timestamp }))
      : [],
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
};

module.exports = { customerOrderResponse };

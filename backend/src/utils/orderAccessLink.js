function orderAccessUrl(frontendUrl, order, email) {
  const orderNumber = String(order?.orderNumber || '');
  const url = new URL(`/order/${encodeURIComponent(orderNumber)}`, frontendUrl);
  if (!order?.user && typeof email === 'string' && email.trim()) {
    url.hash = new URLSearchParams({ email: email.trim().toLowerCase() }).toString();
  }
  return url.toString();
}

module.exports = { orderAccessUrl };

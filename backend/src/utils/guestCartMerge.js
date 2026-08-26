const Cart = require('../models/Cart');
const Product = require('../models/Product');
const { validGuestSessionId } = require('./guestSession');

const MAX_CART_ITEM_QTY = 99;

const usableQuantity = (value) => {
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 0;
};

const isAvailableProduct = (product) => (
  product
  && product.isActive !== false
  && product.stock !== 'out'
  && Number(product.stockQuantity) > 0
);

const currentCartItem = (product, qty) => ({
  product: product._id,
  slug: product.slug,
  sku: product.sku,
  name: product.name,
  price: product.price,
  image: product.images?.[0]?.url || '',
  qty,
});

const quantityCapFor = (product) => Math.min(MAX_CART_ITEM_QTY, Math.floor(Number(product.stockQuantity)));

const plainCartItem = (item) => (
  typeof item?.toObject === 'function' ? item.toObject() : { ...item }
);

/**
 * Merge a user's existing cart with guest items using active product data as
 * the source of truth. Unavailable guest items are omitted, and every active
 * product is capped by both live stock and the cart's 99-item limit.
 */
const mergeCartItems = (existingItems = [], guestItems = [], products = []) => {
  const productsBySlug = new Map(products.map(product => [product.slug, product]));
  const merged = [];
  const indexesBySlug = new Map();

  for (const item of existingItems) {
    const product = productsBySlug.get(item.slug);
    // Preserve unavailable pre-existing items; guest items for them are never
    // added below. Cart read/checkout continue to handle those legacy items.
    if (!isAvailableProduct(product)) {
      if (!indexesBySlug.has(item.slug)) {
        indexesBySlug.set(item.slug, merged.length);
        merged.push(plainCartItem(item));
      }
      continue;
    }

    const qty = Math.min(usableQuantity(item.qty), quantityCapFor(product));
    if (!qty) continue;
    const existingIndex = indexesBySlug.get(product.slug);
    if (existingIndex === undefined) {
      indexesBySlug.set(product.slug, merged.length);
      merged.push(currentCartItem(product, qty));
    } else {
      const existingItem = merged[existingIndex];
      const combinedQty = Math.min(existingItem.qty + qty, quantityCapFor(product));
      Object.assign(existingItem, currentCartItem(product, combinedQty));
    }
  }

  for (const guestItem of guestItems) {
    const product = productsBySlug.get(guestItem.slug);
    if (!isAvailableProduct(product)) continue;

    const guestQty = usableQuantity(guestItem.qty);
    if (!guestQty) continue;

    const cap = quantityCapFor(product);
    const existingIndex = indexesBySlug.get(product.slug);
    if (existingIndex === undefined) {
      const qty = Math.min(guestQty, cap);
      if (qty) {
        indexesBySlug.set(product.slug, merged.length);
        merged.push(currentCartItem(product, qty));
      }
      continue;
    }

    const existingItem = merged[existingIndex];
    // An unavailable existing item is deliberately retained above; do not add
    // a guest quantity until the product is actively purchasable again.
    if (!isAvailableProduct(productsBySlug.get(existingItem.slug))) continue;
    existingItem.qty = Math.min(existingItem.qty + guestQty, cap);
    Object.assign(existingItem, currentCartItem(product, existingItem.qty));
  }

  return merged;
};

const mergeGuestCartForUser = async (userId, sessionId) => {
  sessionId = validGuestSessionId(sessionId);
  if (!sessionId) return;

  const guestCart = await Cart.findOne({ sessionId });
  if (!guestCart) return;

  const userCart = await Cart.findOne({ user: userId });
  const allItems = [...(userCart?.items || []), ...guestCart.items];
  const slugs = [...new Set(allItems.map(item => item.slug).filter(Boolean))];
  const products = slugs.length
    ? await Product.find({ slug: { $in: slugs }, isActive: true }).lean()
    : [];

  if (userCart) {
    userCart.items = mergeCartItems(userCart.items, guestCart.items, products);
    await userCart.save();
    await Cart.deleteOne({ _id: guestCart._id });
    return;
  }

  guestCart.items = mergeCartItems([], guestCart.items, products);
  guestCart.user = userId;
  guestCart.sessionId = undefined;
  await guestCart.save();
};

module.exports = {
  MAX_CART_ITEM_QTY,
  mergeCartItems,
  mergeGuestCartForUser,
};

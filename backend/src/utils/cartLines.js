const Product = require('../models/Product');

const lineProductId = (item) => item?.product?._id || item?.product || null;

// The purchasable product behind each cart line, as [{ item, product }].  One rule for the cart page, checkout and shipping quotes,
// so a line the buyer sees is a line they are charged for.  A line is found by its product id (a slug rename or edit must not lose
// it); the stored slug is only the fallback for legacy lines saved without an id.  Lines whose product is gone, inactive or not a
// Server stick are left out, the same way everywhere.
async function resolveCartLines(items, { lean = false } = {}) {
  const lines = Array.isArray(items) ? items : [];
  const ids = [...new Set(lines.map(lineProductId).filter(Boolean).map(String))];
  const slugs = [...new Set(lines.filter((item) => !lineProductId(item)).map((item) => item?.slug).filter(Boolean))];
  const either = [...(ids.length ? [{ _id: { $in: ids } }] : []), ...(slugs.length ? [{ slug: { $in: slugs } }] : [])];
  if (!either.length) return [];
  const query = Product.find({ $or: either, isActive: true, line: 'Server' });
  const products = await (lean ? query.lean() : query);
  const byId = new Map(products.map((product) => [String(product._id), product]));
  const bySlug = new Map(products.map((product) => [product.slug, product]));
  return lines
    .map((item) => ({ item, product: lineProductId(item) ? byId.get(String(lineProductId(item))) : bySlug.get(item?.slug) }))
    .filter(({ product }) => product);
}

module.exports = { lineProductId, resolveCartLines };

const express = require('express');
const Product = require('../models/Product');
const { normalizeProductPagination, buildProductSort } = require('../utils/pagination');
const {
  PUBLIC_PRODUCT_PROJECTION,
  ProductQueryError,
  parseProductQuery,
} = require('../utils/publicProducts');

const router = express.Router();

const preventStaleProductCache = (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
};

router.use(preventStaleProductCache);

// ─── GET /api/products ─────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { filter, sort, order } = parseProductQuery(req.query);
    const sortObj = buildProductSort(sort, order);
    const pagination = normalizeProductPagination(req.query.page, req.query.limit);

    const [products, total] = await Promise.all([
      Product.find(filter)
        .select(PUBLIC_PRODUCT_PROJECTION)
        .sort(sortObj)
        .skip(pagination.skip)
        .limit(pagination.limit)
        .lean(),
      Product.countDocuments(filter),
    ]);

    res.json({
      products,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        pages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (err) {
    if (err instanceof ProductQueryError) return res.status(err.status).json({ error: err.message });
    console.error('Products list error:', err);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// ─── GET /api/products/featured ───────────────────────────────────────────────
router.get('/featured', async (req, res) => {
  try {
    const products = await Product.find({ isActive: true, isFeatured: true })
      .select(PUBLIC_PRODUCT_PROJECTION)
      .sort({ createdAt: -1 })
      .limit(8)
      .lean();
    res.json({ products });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch featured products' });
  }
});

// ─── GET /api/products/filters ─────────────────────────────────────────────────
router.get('/filters', async (req, res) => {
  try {
    const [generations, formFactors, capacities, conditions, priceRange] = await Promise.all([
      Product.distinct('generation', { isActive: true }),
      Product.distinct('formFactor', { isActive: true }),
      Product.distinct('capacity', { isActive: true }),
      Product.distinct('condition', { isActive: true }),
      Product.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: null, min: { $min: '$price' }, max: { $max: '$price' } } },
      ]),
    ]);

    res.json({
      generation: generations.sort(),
      formFactor: formFactors.sort(),
      capacity: capacities.sort((a, b) => a - b),
      condition: conditions,
      priceRange: priceRange[0] || { min: 0, max: 1000 },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch filters' });
  }
});

// ─── GET /api/products/:slug ───────────────────────────────────────────────────
router.get('/:slug', async (req, res) => {
  try {
    const product = await Product.findOne({
      slug: req.params.slug,
      isActive: true,
    }).select(PUBLIC_PRODUCT_PROJECTION).lean();

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Fetch related products (same generation, different product)
    const related = await Product.find({
      generation: product.generation,
      _id: { $ne: product._id },
      isActive: true,
    })
      .select(PUBLIC_PRODUCT_PROJECTION)
      .limit(4)
      .lean();

    res.json({ product, related });
  } catch (err) {
    console.error('Product detail error:', err);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

module.exports = router;

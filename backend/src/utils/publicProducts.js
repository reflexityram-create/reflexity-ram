const PUBLIC_PRODUCT_PROJECTION = Object.freeze({
  slug: 1,
  sku: 1,
  name: 1,
  description: 1,
  brand: 1,
  mpn: 1,
  line: 1,
  generation: 1,
  formFactor: 1,
  capacity: 1,
  capacityLabel: 1,
  kit: 1,
  speed: 1,
  speedLabel: 1,
  cas: 1,
  timings: 1,
  voltage: 1,
  ecc: 1,
  rank: 1,
  profile: 1,
  heatspreader: 1,
  rgb: 1,
  condition: 1,
  warranty: 1,
  price: 1,
  compareAt: 1,
  stock: 1,
  stockLabel: 1,
  estimatedDispatch: 1,
  'images.url': 1,
  'images.alt': 1,
  tags: 1,
  compatibility: 1,
  included: 1,
  note: 1,
  isFeatured: 1,
  metaTitle: 1,
  metaDescription: 1,
  createdAt: 1,
});

const FILTER_VALUES = Object.freeze({
  generation: new Set(['DDR4', 'DDR5']),
  formFactor: new Set(['UDIMM', 'SO-DIMM', 'RDIMM', 'LRDIMM']),
  condition: new Set(['New', 'Open Box — Tested', 'Refurbished — Tested', 'Used']),
  stock: new Set(['in', 'low', 'out']),
});

const SORT_FIELDS = new Set(['price', 'createdAt', 'name', 'speed', 'capacity']);

class ProductQueryError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

function scalarString(value, field, maxLength = 200) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new ProductQueryError(`Invalid ${field} filter`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) throw new ProductQueryError(`Invalid ${field} filter`);
  return trimmed;
}

function enumCsv(value, field) {
  if (value === undefined) return undefined;
  const raw = scalarString(value, field, 240);
  const values = raw.split(',').map((entry) => entry.trim());
  if (values.length > 12 || values.some((entry) => !entry || !FILTER_VALUES[field].has(entry))) {
    throw new ProductQueryError(`Invalid ${field} filter`);
  }
  return [...new Set(values)];
}

function capacityCsv(value) {
  if (value === undefined) return undefined;
  const raw = scalarString(value, 'capacity', 160);
  const values = raw.split(',').map((entry) => Number(entry.trim()));
  if (
    values.length > 12
    || values.some((entry) => !Number.isSafeInteger(entry) || entry <= 0 || entry > 1_048_576)
  ) {
    throw new ProductQueryError('Invalid capacity filter');
  }
  return [...new Set(values)];
}

function price(value, field) {
  if (value === undefined) return undefined;
  const raw = scalarString(value, field, 40);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000_000) {
    throw new ProductQueryError(`Invalid ${field} filter`);
  }
  return parsed;
}

function parseProductQuery(query = {}) {
  const filter = { isActive: true };
  const generation = enumCsv(query.generation, 'generation');
  const formFactor = enumCsv(query.formFactor, 'formFactor');
  const capacity = capacityCsv(query.capacity);
  const condition = enumCsv(query.condition, 'condition');
  const stock = enumCsv(query.stock, 'stock');
  const minPrice = price(query.minPrice, 'minimum price');
  const maxPrice = price(query.maxPrice, 'maximum price');

  if (generation) filter.generation = { $in: generation };
  if (formFactor) filter.formFactor = { $in: formFactor };
  if (capacity) filter.capacity = { $in: capacity };
  if (condition) filter.condition = { $in: condition };
  if (stock) filter.stock = { $in: stock };

  if (minPrice !== undefined || maxPrice !== undefined) {
    if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
      throw new ProductQueryError('Minimum price cannot exceed maximum price');
    }
    filter.price = {};
    if (minPrice !== undefined) filter.price.$gte = minPrice;
    if (maxPrice !== undefined) filter.price.$lte = maxPrice;
  }

  if (query.featured !== undefined) {
    const featured = scalarString(query.featured, 'featured', 5);
    if (!['true', 'false'].includes(featured)) throw new ProductQueryError('Invalid featured filter');
    if (featured === 'true') filter.isFeatured = true;
  }

  const search = query.search === undefined ? undefined : scalarString(query.search, 'search', 160);
  if (search) filter.$text = { $search: search };

  const sort = query.sort === undefined ? 'createdAt' : scalarString(query.sort, 'sort', 20);
  const order = query.order === undefined ? 'desc' : scalarString(query.order, 'order', 4);
  if (!SORT_FIELDS.has(sort)) throw new ProductQueryError('Invalid sort field');
  if (!['asc', 'desc'].includes(order)) throw new ProductQueryError('Invalid sort order');

  return { filter, sort, order };
}

module.exports = {
  PUBLIC_PRODUCT_PROJECTION,
  ProductQueryError,
  parseProductQuery,
};

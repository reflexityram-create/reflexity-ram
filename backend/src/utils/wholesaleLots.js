const crypto = require('crypto');

const WHOLESALE_IMAGE_PREFIX = 'reflexity-ram/wholesale/';
const WHOLESALE_CLOUDINARY_CLOUD = 'fike';

const LOT_FIELDS = Object.freeze([
  'title',
  'brand',
  'mpn',
  'generation',
  'formFactor',
  'capacityLabel',
  'speedLabel',
  'rank',
  'condition',
  'testStatus',
  'warranty',
  'unitPriceCad',
  'quantityAvailable',
  'minimumOrderQuantity',
  'orderIncrement',
  'shipFrom',
  'notes',
  'image',
]);

const STRING_LIMITS = Object.freeze({
  title: 180,
  brand: 100,
  mpn: 120,
  generation: 12,
  formFactor: 20,
  capacityLabel: 40,
  speedLabel: 40,
  rank: 40,
  condition: 80,
  testStatus: 120,
  warranty: 160,
  shipFrom: 120,
  notes: 2400,
});

const ENUMS = Object.freeze({
  generation: ['DDR3', 'DDR4', 'DDR5'],
  formFactor: ['UDIMM', 'SO-DIMM', 'RDIMM', 'LRDIMM'],
  condition: ['New', 'Open Box — Tested', 'Refurbished — Tested', 'Server Pull — Tested', 'Used'],
});

function cleanString(value, limit) {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.trim();
  if (!cleaned) return '';
  return cleaned.length <= limit ? cleaned : null;
}

function isWholesaleImage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (typeof value.url !== 'string' || typeof value.publicId !== 'string') return false;
  if (value.url.length > 2048 || value.publicId.length > 360) return false;
  if (!new RegExp(`^${WHOLESALE_IMAGE_PREFIX}[A-Za-z0-9][A-Za-z0-9._-]*$`).test(value.publicId)) return false;
  try {
    const parsed = new URL(value.url);
    if (parsed.protocol !== 'https:'
      || parsed.hostname !== 'res.cloudinary.com'
      || parsed.username
      || parsed.password
      || parsed.port
      || parsed.search
      || parsed.hash) return false;

    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length < 7
      || segments[0] !== WHOLESALE_CLOUDINARY_CLOUD
      || segments[1] !== 'image'
      || segments[2] !== 'upload') return false;

    // Cloudinary delivery URLs may carry transformations before their immutable
    // version segment. Everything after that version is the delivered asset,
    // and must be exactly the accepted public ID plus its image format.
    const versionIndex = segments.findIndex((segment, index) => index >= 3 && /^v\d+$/.test(segment));
    if (versionIndex === -1 || versionIndex === segments.length - 1) return false;
    const assetSegments = segments.slice(versionIndex + 1);
    const lastSegment = assetSegments.at(-1);
    const format = lastSegment.match(/^(.+)\.(jpg|jpeg|png|webp|avif)$/i);
    if (!format) return false;
    assetSegments[assetSegments.length - 1] = format[1];
    const deliveredPublicId = assetSegments.map((segment) => decodeURIComponent(segment)).join('/');
    return deliveredPublicId === value.publicId;
  } catch {
    return false;
  }
}

function cleanWholesaleImage(value) {
  if (value === null || value === '' || value === undefined) return null;
  const image = {
    url: typeof value.url === 'string' ? value.url.trim() : '',
    publicId: typeof value.publicId === 'string' ? value.publicId.trim() : '',
  };
  const alt = cleanString(value.alt, 180);
  if (alt === null || !isWholesaleImage(image)) return undefined;
  if (alt) image.alt = alt;
  return image;
}

function cleanWholesaleLotInput(input = {}) {
  const data = {};
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { data, errors: ['Wholesale lot input must be a JSON object.'] };
  }

  for (const field of LOT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(input, field)) continue;
    if (field === 'image') {
      const image = cleanWholesaleImage(input.image);
      if (image === undefined) errors.push('Use a wholesale image uploaded to Reflexity.');
      else data.image = image;
      continue;
    }
    if (field === 'unitPriceCad') {
      const number = Number(input[field]);
      if (!Number.isFinite(number) || number <= 0 || number > 1_000_000
        || Math.round(number * 100) !== number * 100) {
        errors.push('unitPriceCad must be a positive CAD amount with at most two decimal places.');
      } else {
        data.unitPriceCad = number;
      }
      continue;
    }
    if (['quantityAvailable', 'minimumOrderQuantity', 'orderIncrement'].includes(field)) {
      const number = Number(input[field]);
      if (!Number.isInteger(number) || number < (field === 'quantityAvailable' ? 0 : 1) || number > 1_000_000) {
        errors.push(`${field} must be a valid whole number.`);
      } else {
        data[field] = number;
      }
      continue;
    }
    const value = cleanString(input[field], STRING_LIMITS[field]);
    if (value === undefined) {
      errors.push(`${field} must be text.`);
      continue;
    }
    if (value === null) {
      errors.push(`${field} is too long.`);
      continue;
    }
    if (ENUMS[field] && value && !ENUMS[field].includes(value)) {
      errors.push(`Invalid ${field}.`);
      continue;
    }
    data[field] = field === 'mpn' ? value.toUpperCase() : value;
  }
  return { data, errors };
}

function publicationErrors(lot = {}) {
  const required = [
    'title', 'brand', 'mpn', 'generation', 'formFactor', 'capacityLabel', 'speedLabel',
    'condition', 'testStatus', 'warranty', 'shipFrom',
  ];
  const { errors } = cleanWholesaleLotInput(lot);
  for (const field of required) {
    if (!lot[field] || typeof lot[field] !== 'string' || !lot[field].trim()) {
      errors.push(`${field} is required before publishing.`);
    }
  }
  if (!isWholesaleImage(lot.image)) errors.push('A valid wholesale image is required before publishing.');
  if (!Number.isInteger(lot.quantityAvailable) || lot.quantityAvailable < 1) {
    errors.push('quantityAvailable must be at least 1 before publishing.');
  }
  if (!Number.isInteger(lot.minimumOrderQuantity) || lot.minimumOrderQuantity < 1) {
    errors.push('minimumOrderQuantity must be at least 1 before publishing.');
  }
  if (!Number.isInteger(lot.orderIncrement) || lot.orderIncrement < 1) {
    errors.push('orderIncrement must be at least 1 before publishing.');
  }
  if (Number.isInteger(lot.quantityAvailable) && Number.isInteger(lot.minimumOrderQuantity)
    && lot.quantityAvailable < lot.minimumOrderQuantity) {
    errors.push('quantityAvailable must meet the minimum order quantity before publishing.');
  }
  return errors;
}

function isPublicWholesaleLot(lot) {
  return Boolean(lot
    && lot.status === 'published'
    && lot.visibility === 'public'
    && !lot.archivedAt
    && lot.quoteOnly === true
    && publicationErrors(lot).length === 0);
}

function publicWholesaleLot(lot) {
  if (!isPublicWholesaleLot(lot)) return null;
  const { _id, lotCode, title, brand, mpn, generation, formFactor, capacityLabel, speedLabel,
    rank, condition, testStatus, warranty, unitPriceCad, quantityAvailable, minimumOrderQuantity,
    orderIncrement, shipFrom, notes, image, publishedAt } = lot;
  return {
    id: String(_id), lotCode, status: 'published', visibility: 'public', quoteOnly: true,
    title, brand, mpn, generation, formFactor, capacityLabel,
    speedLabel, rank, condition, testStatus, warranty, unitPriceCad, quantityAvailable,
    minimumOrderQuantity, orderIncrement, shipFrom, notes, imageUrl: image.url,
    imageAlt: image.alt || '', publishedAt,
  };
}

function adminWholesaleLot(lot) {
  if (!lot) return null;
  const object = typeof lot.toObject === 'function' ? lot.toObject() : lot;
  return {
    ...object,
    id: String(object._id),
    version: Number.isInteger(object.__v) ? object.__v : 0,
  };
}

function makeLotCode() {
  return `WS-${new Date().getUTCFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

module.exports = {
  LOT_FIELDS,
  WHOLESALE_IMAGE_PREFIX,
  WHOLESALE_CLOUDINARY_CLOUD,
  adminWholesaleLot,
  cleanWholesaleImage,
  cleanWholesaleLotInput,
  isPublicWholesaleLot,
  isWholesaleImage,
  makeLotCode,
  publicationErrors,
  publicWholesaleLot,
};

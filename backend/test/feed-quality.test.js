// Google Merchant Center "Store quality" signals the product feed has to carry:
// delivery time on every shipping line, a high-resolution image that fills the frame,
// a Google product category, spec details and every extra photo.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const express = require('express');

process.env.NODE_ENV ||= 'test';

const Product = require('../src/models/Product');
const feedRouter = require('../src/routes/feed');
const { HANDLING_DAYS, SHIPPING_OPTIONS } = require('../src/config/shipping');
const { AI_LABELED_FEED_IMAGES, labeledFeedImagePath } = require('../src/config/feedImages');

const CLOUDINARY = 'https://res.cloudinary.com/demo/image/upload/v1700000000/reflexity-ram/products/module.jpg';

const product = (overrides = {}) => ({
  sku: 'RFX-TEST-16GB',
  slug: 'rfx-test-16gb',
  name: 'SK hynix 16GB DDR4-3200 ECC RDIMM Server Memory',
  description: 'Tested server memory module with a full specification listing.',
  price: 135,
  images: [{ url: CLOUDINARY }],
  isActive: true,
  stock: 'in',
  line: 'Server',
  brand: 'SK hynix',
  mpn: 'HMA82GR7DJR8N-XN',
  condition: 'Refurbished — Tested',
  generation: 'DDR4',
  formFactor: 'RDIMM',
  capacityLabel: '16GB',
  speedLabel: 'PC4-3200AA',
  voltage: '1.2V',
  ecc: true,
  rank: '2Rx8',
  ...overrides,
});
const productQuery = (items) => ({
  lean: async () => items,
  then: (resolve, reject) => Promise.resolve(items).then(resolve, reject),
});

async function get(app, path) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
    return { status: response.status, text: await response.text() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function feedItems(items, path = '/feed.xml') {
  const original = Product.find;
  try {
    Product.find = () => productQuery(items);
    const app = express();
    app.use('/', feedRouter);
    const response = await get(app, path);
    assert.equal(response.status, 200);
    return response.text;
  } finally {
    Product.find = original;
  }
}

test('each item carries plain-fact product highlights built from its spec fields, and nothing is invented', async () => {
  const xml = await feedItems([
    product({ speed: 3200, cas: 'CL22', warranty: '30 Days' }),
    product({ sku: 'RFX-SPARSE', slug: 'rfx-sparse', brand: '', mpn: '', condition: '', generation: '', formFactor: '', capacityLabel: '', rank: '', voltage: '', ecc: false }),
  ]);
  const items = xml.split('<item>').slice(1);
  const highlights = (item) => [...item.matchAll(/<g:product_highlight>([^<]*)<\/g:product_highlight>/g)].map((m) => m[1]);
  assert.deepEqual(highlights(items[0]), [
    '16GB DDR4-3200 ECC RDIMM',
    '2Rx8, 1.2V, CL22',
    'Manufacturer part number HMA82GR7DJR8N-XN',
    'Condition: Refurbished — Tested, 30 Days warranty',
  ]);
  assert.deepEqual(highlights(items[1]), [], 'a product with no spec fields gets no highlights rather than made-up ones');
  assert.equal((xml.match(/<g:product_highlight>/g) || []).length, 4);
});

test('a voltage stored with or without its unit is shown once', async () => {
  for (const [stored, shown] of [['1.2', '1.2V'], ['1.2V', '1.2V'], ['1.35v', '1.35v']]) {
    const xml = await feedItems([product({ voltage: stored, rank: '2Rx8', speed: 0 })]);
    assert.match(xml, new RegExp(`<g:product_highlight>2Rx8, ${shown}</g:product_highlight>`), stored);
  }
});

test('every shipping line states handling and transit days that match the saved policy', async () => {
  assert.deepEqual(HANDLING_DAYS, { min: 1, max: 3 });
  assert.equal(SHIPPING_OPTIONS.standard.minDays, 3);
  assert.equal(SHIPPING_OPTIONS.standard.maxDays, 6);

  const xml = await feedItems([product()]);
  const lines = xml.match(/<g:shipping>[\s\S]*?<\/g:shipping>/g);
  // Without Canada Post keys (as here) only the Canada line is written, and the
  // US is never promised (US orders paused 2026-10-04: duties must be prepaid).
  assert.equal(lines.length, 1);
  for (const line of lines) {
    assert.match(line, /<g:min_handling_time>1<\/g:min_handling_time><g:max_handling_time>3<\/g:max_handling_time>/);
    assert.match(line, /<g:min_transit_time>3<\/g:min_transit_time><g:max_transit_time>6<\/g:max_transit_time>/);
    assert.match(line, /<g:price>14 CAD<\/g:price>/);
  }
  assert.match(lines[0], /<g:country>CA<\/g:country>/);
  assert.doesNotMatch(xml, /<g:country>US<\/g:country>/);
});

test('the feed image is a trimmed, padded 1200x900 delivery of the Cloudinary original', async () => {
  const xml = await feedItems([product()]);
  const link = xml.match(/<g:image_link>(.*?)<\/g:image_link>/)[1];
  assert.equal(
    link,
    'https://res.cloudinary.com/demo/image/upload/e_trim:12/c_fit,w_1100,h_800/c_pad,w_1200,h_900,b_white/f_jpg,q_auto:good/v1700000000/reflexity-ram/products/module.jpg',
  );
  // Never transformed twice, and non-Cloudinary URLs are left alone.
  const twice = await feedItems([product({ images: [{ url: link }] })]);
  assert.equal(twice.match(/<g:image_link>(.*?)<\/g:image_link>/)[1], link);
  const foreign = await feedItems([product({ images: [{ url: 'https://images.example.test/a.jpg' }] })]);
  assert.equal(foreign.match(/<g:image_link>(.*?)<\/g:image_link>/)[1], 'https://images.example.test/a.jpg');
});

test('extra photos become additional_image_link entries (at most nine) and a product with none has none', async () => {
  const many = Array.from({ length: 12 }, (_, index) => ({ url: `${CLOUDINARY.replace('module', `module-${index}`)}` }));
  const withExtras = await feedItems([product({ images: many })]);
  assert.equal((withExtras.match(/<g:additional_image_link>/g) || []).length, 9);
  assert.match(withExtras.match(/<g:additional_image_link>(.*?)<\/g:additional_image_link>/)[1], /e_trim:12\/.*module-1\.jpg$/);
  const single = await feedItems([product()]);
  assert.equal(single.includes('additional_image_link'), false);
});

test('the feed names the Google RAM category and lists the module specifications', async () => {
  const xml = await feedItems([product()]);
  assert.match(xml, /<g:google_product_category>1733<\/g:google_product_category>/);
  const details = [...xml.matchAll(/<g:attribute_name>(.*?)<\/g:attribute_name><g:attribute_value>(.*?)<\/g:attribute_value>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(details, [
    ['Capacity', '16GB'], ['Memory type', 'DDR4'], ['Form factor', 'RDIMM'], ['Speed', 'PC4-3200AA'],
    ['Voltage', '1.2V'], ['Error correction', 'ECC'], ['Rank', '2Rx8'],
  ]);
  assert.match(xml, /<g:section_name>Specifications<\/g:section_name>/);

  const sparse = await feedItems([product({ voltage: undefined, rank: '', ecc: false, speedLabel: ' ' })]);
  const names = [...sparse.matchAll(/<g:attribute_name>(.*?)<\/g:attribute_name>/g)].map((m) => m[1]);
  assert.deepEqual(names, ['Capacity', 'Memory type', 'Form factor']);
});

test('spec values are XML-escaped and the CSV feed uses the same delivery image', async () => {
  const xml = await feedItems([product({ speedLabel: 'PC4 <3200> & "fast"' })]);
  assert.match(xml, /<g:attribute_value>PC4 &lt;3200&gt; &amp; &quot;fast&quot;<\/g:attribute_value>/);
  const csv = await feedItems([product()], '/feed.csv');
  assert.match(csv, /e_trim:12\/c_fit,w_1100,h_800\/c_pad,w_1200,h_900,b_white\/f_jpg,q_auto:good\/v1700000000/);
});

// ---- AI-generated pictures must keep Google's IPTC label (DigitalSourceType trainedAlgorithmicMedia) ----

const FEED_IMAGE_DIR = path.join(__dirname, '..', '..', 'frontend', 'public');
const AI_ASSET = 'product-1787350684119-9h9uobzbd'; // the Lenovo 16GB picture, AI-generated
const AI_URL = `https://res.cloudinary.com/demo/image/upload/v1787350684/reflexity-ram/products/${AI_ASSET}.jpg`;

// Reads a JPEG's size and embedded XMP the way a crawler would: by walking the segments.
function inspectJpeg(buffer) {
  assert.equal(buffer.readUInt16BE(0), 0xffd8, 'not a JPEG');
  let offset = 2;
  const result = { width: 0, height: 0, xmp: '' };
  while (offset < buffer.length - 4 && buffer[offset] === 0xff) {
    const marker = buffer[offset + 1];
    if (marker === 0xda) break;
    const length = buffer.readUInt16BE(offset + 2);
    const body = buffer.subarray(offset + 4, offset + 2 + length);
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      result.height = body.readUInt16BE(1);
      result.width = body.readUInt16BE(3);
    }
    const header = 'http://ns.adobe.com/xap/1.0/\0';
    if (marker === 0xe1 && body.subarray(0, header.length).toString('latin1') === header) result.xmp = body.subarray(header.length).toString('utf8');
    offset += 2 + length;
  }
  return result;
}
const withoutXmp = (buffer) => {
  const out = [buffer.subarray(0, 2)];
  let offset = 2;
  while (offset < buffer.length - 4 && buffer[offset] === 0xff && buffer[offset + 1] !== 0xda) {
    const length = buffer.readUInt16BE(offset + 2);
    const segment = buffer.subarray(offset, offset + 2 + length);
    const isXmp = buffer[offset + 1] === 0xe1 && segment.subarray(4, 33).toString('latin1').startsWith('http://ns.adobe.com/xap/1.0/');
    if (!isXmp) out.push(segment);
    offset += 2 + length;
  }
  out.push(buffer.subarray(offset));
  return Buffer.concat(out);
};

test('every labeled feed image exists, is 1200x900 and carries the IPTC AI-generated label', () => {
  const entries = Object.entries(AI_LABELED_FEED_IMAGES);
  assert.ok(entries.length >= 3);
  for (const [asset, publicPath] of entries) {
    assert.match(asset, /^product-\d+-[a-z0-9]+$/);
    assert.match(publicPath, /^\/feed-images\/[a-z0-9-]+\.jpg$/);
    const file = path.join(FEED_IMAGE_DIR, publicPath);
    assert.ok(fs.existsSync(file), `${publicPath} is missing from frontend/public`);
    const info = inspectJpeg(fs.readFileSync(file));
    assert.deepEqual([info.width, info.height], [1200, 900], publicPath);
    assert.match(info.xmp, /<Iptc4xmpExt:DigitalSourceType>http:\/\/cv\.iptc\.org\/newscodes\/digitalsourcetype\/trainedAlgorithmicMedia<\/Iptc4xmpExt:DigitalSourceType>/, publicPath);
  }
});

test('the label check itself fails on an image whose XMP was stripped (negative control)', () => {
  const [, publicPath] = Object.entries(AI_LABELED_FEED_IMAGES)[0];
  const original = fs.readFileSync(path.join(FEED_IMAGE_DIR, publicPath));
  assert.match(inspectJpeg(original).xmp, /trainedAlgorithmicMedia/);
  const stripped = withoutXmp(original);
  assert.ok(stripped.length < original.length);
  assert.equal(inspectJpeg(stripped).xmp, '');
  assert.deepEqual([inspectJpeg(stripped).width, inspectJpeg(stripped).height], [1200, 900]);
});

test('the feed serves the labeled copy for a known AI picture, in the XML and the CSV', async () => {
  const items = [product({ images: [{ url: AI_URL }] })];
  const xml = await feedItems(items);
  assert.equal(xml.match(/<g:image_link>(.*?)<\/g:image_link>/)[1], 'https://reflexityram.com/feed-images/rfx-lenovo-16gb-ddr4-3200-ecc-rdim.jpg');
  const csv = await feedItems(items, '/feed.csv');
  assert.match(csv, /https:\/\/reflexityram\.com\/feed-images\/rfx-lenovo-16gb-ddr4-3200-ecc-rdim\.jpg/);
  assert.equal(csv.includes('res.cloudinary.com'), false);
});

test('a real photo never gets the AI copy: the override is keyed by the picture, not by the SKU', async () => {
  // Same product (same SKU), but its first picture is now a different, newly uploaded asset.
  const realUrl = 'https://res.cloudinary.com/demo/image/upload/v1790000000/reflexity-ram/products/product-1790000000000-realphoto1.jpg';
  assert.equal(labeledFeedImagePath(realUrl), null);
  const xml = await feedItems([product({ images: [{ url: realUrl }] })]);
  const link = xml.match(/<g:image_link>(.*?)<\/g:image_link>/)[1];
  assert.equal(link.includes('feed-images'), false);
  assert.match(link, /e_trim:12\/c_fit,w_1100,h_800\/c_pad,w_1200,h_900/);
  assert.match(link, /product-1790000000000-realphoto1\.jpg$/);
});

test('the labeled-image lookup tolerates junk input', () => {
  for (const value of [undefined, null, '', 42, 'not a url', 'https://example.test/product-1-x']) assert.equal(labeledFeedImagePath(value), null);
  assert.equal(labeledFeedImagePath(`${AI_URL}?v=2`), AI_LABELED_FEED_IMAGES[AI_ASSET]);
});

// Abroad, Google gets what checkout charges for one stick: the cheapest tracked Canada Post service per country.
test('the feed adds one shipping line per checkout country at the cheapest tracked Canada Post price', async (t) => {
  const { INTERNATIONAL_COUNTRIES } = require('../src/config/shipping');
  const asked = [];
  feedRouter.setFeedShippingForTest({
    enabled: () => true,
    quote: async ({ country, sticks }) => {
      asked.push([country, sticks]);
      if (country === 'AU') throw new Error('Canada Post timeout');
      if (country === 'JP') return [];
      return [
        { serviceCode: 'INT.TP', name: 'Tracked Packet – International', price: 33.41, transitDays: 7 },
        { serviceCode: 'INT.XP', name: 'Xpresspost – International (guaranteed)', price: country === 'MX' ? 30 : 61.49, transitDays: 6 },
      ];
    },
  });
  t.after(() => feedRouter.setFeedShippingForTest());

  const xml = await feedItems([product()]);
  const lines = xml.match(/<g:shipping>[\s\S]*?<\/g:shipping>/g);
  assert.equal(asked.length, INTERNATIONAL_COUNTRIES.length - 1, 'one quote per checkout country, except South Korea');
  assert.ok(asked.every(([, sticks]) => sticks === 1), 'priced for one stick');
  assert.ok(!asked.some(([country]) => country === 'KR'), 'Google refuses CAD prices in South Korea');
  assert.equal(lines.length, 1 + INTERNATIONAL_COUNTRIES.length - 1 - 2, 'Canada plus every country that has a price');
  assert.match(lines[0], /<g:country>CA<\/g:country>[\s\S]*<g:price>14 CAD<\/g:price>/);
  const gb = lines.find((line) => line.includes('<g:country>GB</g:country>'));
  assert.match(gb, /<g:service>Canada Post Tracked Packet – International<\/g:service>/);
  assert.match(gb, /<g:min_transit_time>7<\/g:min_transit_time><g:max_transit_time>10<\/g:max_transit_time>/);
  assert.match(gb, /<g:price>33\.41 CAD<\/g:price>/);
  const mx = lines.find((line) => line.includes('<g:country>MX</g:country>'));
  assert.match(mx, /Xpresspost[\s\S]*<g:price>30\.00 CAD<\/g:price>/, 'the cheaper service wins');
  for (const missing of ['AU', 'JP', 'US', 'DE', 'KR']) assert.doesNotMatch(xml, new RegExp(`<g:country>${missing}</g:country>`), missing);
});

// Google Merchant Center "Store quality" signals the product feed has to carry:
// delivery time on every shipping line, a high-resolution image that fills the frame,
// a Google product category, spec details and every extra photo.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

process.env.NODE_ENV ||= 'test';

const Product = require('../src/models/Product');
const feedRouter = require('../src/routes/feed');
const { HANDLING_DAYS, SHIPPING_OPTIONS } = require('../src/config/shipping');

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

test('every shipping line states handling and transit days that match the saved policy', async () => {
  assert.deepEqual(HANDLING_DAYS, { min: 1, max: 3 });
  assert.equal(SHIPPING_OPTIONS.standard.minDays, 3);
  assert.equal(SHIPPING_OPTIONS.standard.maxDays, 6);

  const xml = await feedItems([product()]);
  const lines = xml.match(/<g:shipping>[\s\S]*?<\/g:shipping>/g);
  assert.equal(lines.length, 2);
  for (const line of lines) {
    assert.match(line, /<g:min_handling_time>1<\/g:min_handling_time><g:max_handling_time>3<\/g:max_handling_time>/);
    assert.match(line, /<g:min_transit_time>3<\/g:min_transit_time><g:max_transit_time>6<\/g:max_transit_time>/);
    assert.match(line, /<g:price>14 CAD<\/g:price>/);
  }
  assert.match(lines[0], /<g:country>CA<\/g:country>/);
  assert.match(lines[1], /<g:country>US<\/g:country>/);
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

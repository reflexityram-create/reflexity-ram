const express = require('express');
const Product = require('../models/Product');
const { CURRENCY, HANDLING_DAYS, SHIPPING_OPTIONS, shippingPriceForProduct } = require('../config/shipping');
const { labeledFeedImagePath } = require('../config/feedImages');

const router = express.Router();
const BASE_URL = 'https://reflexityram.com';
const STORE_CURRENCY = CURRENCY.toUpperCase();
// Google product category 1733 = Electronics > Electronics Accessories > Memory > RAM.
const GOOGLE_PRODUCT_CATEGORY = 1733;
const MAX_ADDITIONAL_IMAGES = 9;
const STANDARD_OPTION = SHIPPING_OPTIONS.standard;
const publicFeedProducts = () => Product.find({ isActive: true, stock: { $ne: 'out' }, line: 'Server' }).lean();

const xmlEscape = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const cdata = (value) => String(value ?? '').replace(/]]>/g, ']]]]><![CDATA[>');
const csv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const condition = (value) => ({
  New: 'new', 'Open Box — Tested': 'refurbished', 'Refurbished — Tested': 'refurbished', Used: 'used',
}[value] || 'used');
// Shopping surfaces rate image resolution and how much of the frame the product fills.
// Our Cloudinary originals are 960-1200px with wide white margins, so serve a trimmed,
// padded 1200x900 JPEG for the feed only (the storefront keeps the original URLs).
const FEED_IMAGE_TRANSFORM = 'e_trim:12/c_fit,w_1100,h_800/c_pad,w_1200,h_900,b_white/f_jpg,q_auto:good';
const feedImageUrl = (url) => {
  const value = String(url || '');
  const marker = '/image/upload/';
  const at = value.indexOf(marker);
  if (!/^https:\/\/res\.cloudinary\.com\//.test(value) || at < 0 || value.includes(FEED_IMAGE_TRANSFORM)) return value;
  return `${value.slice(0, at + marker.length)}${FEED_IMAGE_TRANSFORM}/${value.slice(at + marker.length)}`;
};
// The first picture: the labeled copy when it is a known AI-generated one, else the trimmed Cloudinary delivery.
const mainImageUrl = (product) => {
  const url = product.images?.[0]?.url;
  const labeled = labeledFeedImagePath(url);
  return labeled ? `${BASE_URL}${labeled}` : feedImageUrl(url);
};
const additionalImages = (product) => (product.images || []).slice(1, 1 + MAX_ADDITIONAL_IMAGES).map((image) => image?.url).filter(Boolean);
const productDetails = (product) => [
  ['Capacity', product.capacityLabel],
  ['Memory type', product.generation],
  ['Form factor', product.formFactor],
  ['Speed', product.speedLabel],
  ['Voltage', product.voltage],
  ['Error correction', product.ecc ? 'ECC' : ''],
  ['Rank', product.rank],
].filter(([, value]) => String(value ?? '').trim());
const shippingXml = (country, shippingPrice) => `<g:shipping><g:country>${country}</g:country><g:service>Standard</g:service>`
  + `<g:min_handling_time>${HANDLING_DAYS.min}</g:min_handling_time><g:max_handling_time>${HANDLING_DAYS.max}</g:max_handling_time>`
  + `<g:min_transit_time>${STANDARD_OPTION.minDays}</g:min_transit_time><g:max_transit_time>${STANDARD_OPTION.maxDays}</g:max_transit_time>`
  + `<g:price>${shippingPrice} ${STORE_CURRENCY}</g:price></g:shipping>`;
const description = (product) => {
  const supplied = (product.description || '').trim();
  return supplied.length >= 20 && !/^\d+$/.test(supplied)
    ? supplied
    : `${product.name} — ${product.generation} ${product.formFactor} ${product.speedLabel || ''}. ${product.condition}.`;
};

router.get('/feed.xml', async (_req, res) => {
  try {
    const products = await publicFeedProducts();
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel>\n';
    xml += `<title>Reflexity RAM</title><link>${BASE_URL}</link><description>Tested server memory modules</description>\n`;
    for (const product of products) {
      const imageUrl = mainImageUrl(product);
      const price = product.compareAt > product.price ? product.compareAt : product.price;
      xml += '<item>\n';
      xml += `<g:id>${xmlEscape(product.sku)}</g:id><title><![CDATA[${cdata(product.name)}]]></title>`;
      xml += `<description><![CDATA[${cdata(description(product))}]]></description>`;
      xml += `<link>${BASE_URL}/shop/${encodeURIComponent(product.slug)}</link>`;
      if (imageUrl) xml += `<g:image_link>${xmlEscape(imageUrl)}</g:image_link>`;
      for (const extra of additionalImages(product)) xml += `<g:additional_image_link>${xmlEscape(feedImageUrl(extra))}</g:additional_image_link>`;
      xml += `<g:price>${price} ${STORE_CURRENCY}</g:price>`;
      if (product.compareAt > product.price) xml += `<g:sale_price>${product.price} ${STORE_CURRENCY}</g:sale_price>`;
      xml += `<g:condition>${condition(product.condition)}</g:condition><g:availability>in_stock</g:availability>`;
      if (product.brand) xml += `<g:brand>${xmlEscape(product.brand)}</g:brand>`;
      if (product.mpn) xml += `<g:mpn>${xmlEscape(product.mpn)}</g:mpn>`;
      xml += `<g:identifier_exists>${Boolean(product.brand && product.mpn)}</g:identifier_exists><g:product_type>Computer Memory</g:product_type>`;
      xml += `<g:google_product_category>${GOOGLE_PRODUCT_CATEGORY}</g:google_product_category>`;
      for (const [name, value] of productDetails(product)) {
        xml += `<g:product_detail><g:section_name>Specifications</g:section_name><g:attribute_name>${xmlEscape(name)}</g:attribute_name><g:attribute_value>${xmlEscape(value)}</g:attribute_value></g:product_detail>`;
      }
      const shippingPrice = shippingPriceForProduct(product);
      for (const country of ['CA', 'US']) xml += shippingXml(country, shippingPrice);
      xml += '</item>\n';
    }
    res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(`${xml}</channel></rss>`);
  } catch (error) {
    console.error('Feed error:', error);
    res.status(500).send('Error generating feed');
  }
});

router.get('/feed.csv', async (_req, res) => {
  try {
    const products = await publicFeedProducts();
    const header = 'id,title,description,link,image_link,price,condition,availability,brand,mpn,identifier_exists,product_type';
    const rows = products.map((product) => [
      product.sku, csv(product.name), csv(description(product)), `${BASE_URL}/shop/${encodeURIComponent(product.slug)}`,
      mainImageUrl(product), `${product.price} ${STORE_CURRENCY}`, condition(product.condition), 'in_stock',
      product.brand || '', product.mpn || '', Boolean(product.brand && product.mpn), 'Computer Memory',
    ].join(','));
    res.type('text/csv').set('Cache-Control', 'public, max-age=3600').send(`${header}\n${rows.join('\n')}`);
  } catch (error) {
    console.error('CSV feed error:', error);
    res.status(500).send('Error generating CSV feed');
  }
});

module.exports = router;

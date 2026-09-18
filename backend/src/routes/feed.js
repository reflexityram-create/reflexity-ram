const express = require('express');
const Product = require('../models/Product');
const { CURRENCY, shippingPriceForProduct } = require('../config/shipping');

const router = express.Router();
const BASE_URL = 'https://reflexityram.com';
const STORE_CURRENCY = CURRENCY.toUpperCase();
const publicFeedProducts = () => Product.find({ isActive: true, stock: { $ne: 'out' }, line: 'Server' }).lean();

const xmlEscape = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const cdata = (value) => String(value ?? '').replace(/]]>/g, ']]]]><![CDATA[>');
const csv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const condition = (value) => ({
  New: 'new', 'Open Box — Tested': 'refurbished', 'Refurbished — Tested': 'refurbished', Used: 'used',
}[value] || 'used');
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
      const imageUrl = product.images?.[0]?.url || '';
      const price = product.compareAt > product.price ? product.compareAt : product.price;
      xml += '<item>\n';
      xml += `<g:id>${xmlEscape(product.sku)}</g:id><title><![CDATA[${cdata(product.name)}]]></title>`;
      xml += `<description><![CDATA[${cdata(description(product))}]]></description>`;
      xml += `<link>${BASE_URL}/shop/${encodeURIComponent(product.slug)}</link>`;
      if (imageUrl) xml += `<g:image_link>${xmlEscape(imageUrl)}</g:image_link>`;
      xml += `<g:price>${price} ${STORE_CURRENCY}</g:price>`;
      if (product.compareAt > product.price) xml += `<g:sale_price>${product.price} ${STORE_CURRENCY}</g:sale_price>`;
      xml += `<g:condition>${condition(product.condition)}</g:condition><g:availability>in_stock</g:availability>`;
      if (product.brand) xml += `<g:brand>${xmlEscape(product.brand)}</g:brand>`;
      if (product.mpn) xml += `<g:mpn>${xmlEscape(product.mpn)}</g:mpn>`;
      xml += `<g:identifier_exists>${Boolean(product.brand && product.mpn)}</g:identifier_exists><g:product_type>Computer Memory</g:product_type>`;
      const shippingPrice = shippingPriceForProduct(product);
      for (const country of ['CA', 'US']) xml += `<g:shipping><g:country>${country}</g:country><g:service>Standard</g:service><g:price>${shippingPrice} ${STORE_CURRENCY}</g:price></g:shipping>`;
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
      product.images?.[0]?.url || '', `${product.price} ${STORE_CURRENCY}`, condition(product.condition), 'in_stock',
      product.brand || '', product.mpn || '', Boolean(product.brand && product.mpn), 'Computer Memory',
    ].join(','));
    res.type('text/csv').set('Cache-Control', 'public, max-age=3600').send(`${header}\n${rows.join('\n')}`);
  } catch (error) {
    console.error('CSV feed error:', error);
    res.status(500).send('Error generating CSV feed');
  }
});

module.exports = router;

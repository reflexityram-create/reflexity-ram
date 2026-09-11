const BASE_URL = 'https://reflexityram.com';

const STATIC_PAGES = [
  { path: '/', changefreq: 'daily', priority: '1.0' },
  { path: '/inventory', changefreq: 'daily', priority: '0.9' },
  { path: '/guides', changefreq: 'weekly', priority: '0.8' },
  { path: '/guides/ddr4-vs-ddr5', changefreq: 'monthly', priority: '0.7' },
  { path: '/guides/ecc-rdimm-udimm-explained', changefreq: 'monthly', priority: '0.7' },
  { path: '/guides/how-to-identify-ram', changefreq: 'monthly', priority: '0.7' },
  { path: '/guides/how-much-ram-do-i-need', changefreq: 'monthly', priority: '0.7' },
  { path: '/wholesale', changefreq: 'monthly', priority: '0.6' },
  { path: '/sell-to-us', changefreq: 'monthly', priority: '0.7' },
  { path: '/contact', changefreq: 'monthly', priority: '0.6' },
  { path: '/about', changefreq: 'monthly', priority: '0.5' },
  { path: '/shipping', changefreq: 'monthly', priority: '0.4' },
  { path: '/international', changefreq: 'monthly', priority: '0.4' },
  { path: '/returns', changefreq: 'monthly', priority: '0.4' },
  { path: '/warranty', changefreq: 'monthly', priority: '0.4' },
  { path: '/faq', changefreq: 'monthly', priority: '0.4' },
  { path: '/privacy', changefreq: 'yearly', priority: '0.3' },
  { path: '/terms', changefreq: 'yearly', priority: '0.3' },
];

module.exports = { BASE_URL, STATIC_PAGES };

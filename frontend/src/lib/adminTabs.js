// The admin's bottom tab bar (components/AdminTabBar.jsx): four places, the same on every page, the store included. Plain data, so the
// "which tab is lit" rule can be tested without a browser. Exactly one tab is lit on any page that has the bar.
const startsWith = (path, prefix) => path === prefix || path.startsWith(`${prefix}/`);
const MORE_PATHS = ['/admin/more', '/admin/users', '/admin/security', '/account'];

export const ADMIN_TAB_DEFS = Object.freeze([
  { key: 'orders', to: '/admin/orders', label: 'Orders', isActive: (path) => startsWith(path, '/admin/orders') },
  { key: 'products', to: '/admin/products', label: 'Products', isActive: (path) => startsWith(path, '/admin/products') },
  // everything that is not the admin and not the account area is the store (home, shop, product, cart, checkout, policies...)
  { key: 'store', to: '/', label: 'Store', isActive: (path) => !startsWith(path, '/admin') && !startsWith(path, '/account') },
  { key: 'more', to: '/admin/more', label: 'More', isActive: (path) => MORE_PATHS.some((prefix) => startsWith(path, prefix)) },
]);

export const activeAdminTab = (path) => ADMIN_TAB_DEFS.find((tab) => tab.isActive(path))?.key ?? null;

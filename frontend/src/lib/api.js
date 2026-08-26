import axios from 'axios';
import { clearPersistedAuthSnapshot } from './authSession';

const API_BASE = import.meta.env.VITE_API_URL || 'https://reflexity-ram.onrender.com/api';

const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ─── Request Interceptor ──────────────────────────────────────────────────────
api.interceptors.request.use((config) => {
  // Attach JWT token from localStorage if present
  const token = localStorage.getItem('rfx_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  // Attach session ID for guest cart
  const sessionId = getOrCreateSessionId();
  config.headers['x-session-id'] = sessionId;

  return config;
});

// ─── Response Interceptor ─────────────────────────────────────────────────────
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const { response } = error;
    if (response?.status === 401) {
      if (response.data?.code === 'TOKEN_EXPIRED' || response.data?.error === 'Invalid token') {
        console.warn('[Auth] Token invalid or expired, clearing session');
        clearPersistedAuthSnapshot();
        window.dispatchEvent(new CustomEvent('auth:expired'));
      }
    }
    
    // Log CORS or Network errors specifically for debugging
    if (!response) {
      console.error('[API] Network Error / CORS issue. Check if backend is alive and allows this origin:', window.location.origin);
    }

    return Promise.reject(error);
  }
);

// ─── Session ID for Guest Cart ─────────────────────────────────────────────────
export function getOrCreateSessionId() {
  let sessionId = localStorage.getItem('rfx_session_id');
  if (!sessionId) {
    sessionId = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem('rfx_session_id', sessionId);
  }
  return sessionId;
}

// ─── Auth API ─────────────────────────────────────────────────────────────────
export const authApi = {
  signup: (data) => api.post('/auth/signup', { ...data, sessionId: getOrCreateSessionId() }),
  login: (data) => api.post('/auth/login', { ...data, sessionId: getOrCreateSessionId() }),
  logout: () => api.post('/auth/logout'),
  me: () => api.get('/auth/me'),
  verifyEmail: (token) => api.post('/auth/verify-email', { token }),
  resendVerification: () => api.post('/auth/resend-verification'),
  forgotPassword: (email) => api.post('/auth/forgot-password', { email }),
  resetPassword: (token, password) => api.post('/auth/reset-password', { token, password }),
  updateProfile: (data) => api.patch('/auth/profile', data),
  changePassword: (data) => api.post('/auth/change-password', data),
};

// ─── Products API ─────────────────────────────────────────────────────────────
export const productsApi = {
  list: (params, config = {}) => api.get('/products', { ...config, params }),
  featured: () => api.get('/products/featured'),
  filters: () => api.get('/products/filters'),
  getBySlug: (slug) => api.get(`/products/${slug}`),
};

// ─── Wholesale lots API ──────────────────────────────────────────────────────
// Quote-only wholesale inventory is intentionally separate from retail
// products, checkout stock, Stripe, orders, and the Merchant feed.
export const wholesaleApi = {
  list: (config = {}) => api.get('/wholesale', config),
};

// Reviews are public to read, but the server only accepts verified purchases.
export const reviewsApi = {
  list: (slug) => api.get(`/reviews/product/${slug}`),
  create: (slug, data) => api.post(`/reviews/product/${slug}`, data),
};

// ─── Cart API ─────────────────────────────────────────────────────────────────
export const cartApi = {
  get: () => api.get('/cart'),
  add: (slug, qty) => api.post('/cart/add', { slug, qty }),
  update: (slug, qty) => api.patch('/cart/update', { slug, qty }),
  remove: (slug) => api.delete(`/cart/remove/${slug}`),
  clear: () => api.delete('/cart/clear'),
};

// ─── Orders API ───────────────────────────────────────────────────────────────
export const ordersApi = {
  list: (params) => api.get('/orders', { params }),
  getByNumber: (orderNumber, email) =>
    api.get(`/orders/${orderNumber}`, { params: email ? { email } : {} }),
};

// ─── Stripe API ───────────────────────────────────────────────────────────────
export const stripeApi = {
  createCheckoutSession: () => api.post('/stripe/create-checkout-session'),
  sessionStatus: (sessionId) =>
    api.get('/stripe/session-status', { params: { session_id: sessionId } }),
};

// ─── Admin API ────────────────────────────────────────────────────────────────
export const adminApi = {
  stats: () => api.get('/admin/stats'),

  // Products
  listProducts: (params) => api.get('/admin/products', { params }),
  getProduct: (id) => api.get(`/admin/products/${id}`, { params: { _t: Date.now() } }),
  createProduct: (data) => api.post('/admin/products', data),
  updateProduct: (id, data) => api.patch(`/admin/products/${id}`, data),
  deleteProduct: (id) => api.delete(`/admin/products/${id}`),
  updateStock: (id, stockQuantity) => api.patch(`/admin/products/${id}/stock`, { stockQuantity }),

  // Wholesale lots
  listWholesaleLots: (params) => api.get('/admin/wholesale', { params }),
  getWholesaleLot: (id) => api.get(`/admin/wholesale/${id}`, { params: { _t: Date.now() } }),
  createWholesaleLot: (data) => api.post('/admin/wholesale', data),
  updateWholesaleLot: (id, data) => api.patch(`/admin/wholesale/${id}`, data),
  publishWholesaleLot: (id, version) => api.post(`/admin/wholesale/${id}/publish`, { version }),
  unpublishWholesaleLot: (id, version) => api.post(`/admin/wholesale/${id}/unpublish`, { version }),
  archiveWholesaleLot: (id, version) => api.delete(`/admin/wholesale/${id}`, { data: { version } }),
  restoreWholesaleLot: (id, version) => api.post(`/admin/wholesale/${id}/restore`, { version }),

  // Orders
  listOrders: (params) => api.get('/admin/orders', { params }),
  getOrder: (id) => api.get(`/admin/orders/${id}`),
  updateOrderStatus: (id, data) => api.patch(`/admin/orders/${id}/status`, data),
  archiveOrder: (id, archived) => api.patch(`/admin/orders/${id}/archive`, { archived }),

  // Users
  listUsers: (params) => api.get('/admin/users', { params }),
  updateUser: (id, data) => api.patch(`/admin/users/${id}`, data),
  getUserOrders: (id) => api.get(`/admin/users/${id}/orders`),

  // Upload
  uploadImages: (formData) =>
    api.post('/upload/products', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  deleteImage: (publicId) =>
    api.delete(`/upload/products/${encodeURIComponent(publicId)}`),
  uploadWholesaleImage: (formData) =>
    api.post('/upload/wholesale', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  deleteWholesaleImage: (publicId) =>
    api.delete(`/upload/wholesale/${encodeURIComponent(publicId)}`),
};

// ─── Editable page content (shipping / returns / warranty / faq) ───────────────
export const pagesApi = {
  get: (slug) => api.get(`/pages/${slug}`),
  save: (slug, data) => api.put(`/pages/${slug}`, data),
  reset: (slug) => api.delete(`/pages/${slug}`),
};

export default api;

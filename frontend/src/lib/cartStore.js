import { create } from 'zustand';
import { cartApi } from './api';

const cartState = (cart) => ({
  items: cart.items || [],
  subtotal: cart.subtotal || 0,
  shipping: cart.shipping || 0,
  shippingFaster: cart.shippingFaster ?? null,
  itemCount: cart.itemCount || 0,
  discount: cart.discount || 0,
  couponCode: cart.couponCode || null,
  loaded: true,
  loadFailed: false,
});

// Every cart request takes a number and only the newest one's answer is applied: a slow read that started before an
// "Add to cart" (the server can take seconds to wake up) must not put the older cart back when it finally arrives.
let latestRequest = 0;

const useCartStore = create((set, get) => ({
  items: [],
  shipping: 0,
  shippingFaster: null, // price of Faster shipping for this cart, null when not offered
  subtotal: 0,
  itemCount: 0,
  discount: 0,
  couponCode: null,
  isLoading: false,
  loaded: false,     // the server's cart has been read (or changed) at least once since the page loaded
  loadFailed: false, // the last read failed: the cart pages offer to try again instead of saying the cart is empty
  isOpen: false,

  // Fetch cart from server — only overwrites store if fetch succeeds
  fetchCart: async () => {
    const request = ++latestRequest;
    set({ isLoading: true, loadFailed: false });
    try {
      const { data } = await cartApi.get();
      if (request !== latestRequest) return;
      set({
        ...cartState(data.cart),
        isLoading: false,
      });
    } catch (err) {
      if (request !== latestRequest) return;
      // Don't wipe items on network error — keep whatever is in memory
      set({ isLoading: false, loadFailed: true });
      console.error('Failed to fetch cart:', err?.response?.data || err?.message || err);
    }
  },

  // Add item to cart
  addItem: async (slug, qty = 1) => {
    const request = ++latestRequest;
    set({ isLoading: true });
    try {
      const { data } = await cartApi.add(slug, qty);
      if (request === latestRequest) {
        set({
          ...cartState(data.cart),
          isLoading: false,
        });
      }
      return { success: true };
    } catch (err) {
      if (request === latestRequest) set({ isLoading: false });
      const message = err.response?.data?.error || 'Failed to add to cart';
      console.error('addItem error:', err?.response?.data || err?.message);
      return { success: false, message };
    }
  },

  // Update item quantity
  updateItem: async (slug, qty) => {
    const request = ++latestRequest;
    set({ isLoading: true });
    try {
      const { data } = await cartApi.update(slug, qty);
      if (request === latestRequest) {
        set({
          ...cartState(data.cart),
          isLoading: false,
        });
      }
      return { success: true };
    } catch (err) {
      if (request === latestRequest) set({ isLoading: false });
      console.error('updateItem error:', err?.response?.data || err?.message);
      return { success: false, message: err.response?.data?.error || 'Could not update the quantity' };
    }
  },

  // Remove item from cart
  removeItem: async (slug) => {
    const request = ++latestRequest;
    set({ isLoading: true });
    try {
      const { data } = await cartApi.remove(slug);
      if (request === latestRequest) {
        set({
          ...cartState(data.cart),
          isLoading: false,
        });
      }
    } catch (err) {
      if (request === latestRequest) set({ isLoading: false });
      console.error('removeItem error:', err?.response?.data || err?.message);
    }
  },

  // Clear cart on server + locally
  clearCart: async () => {
    const request = ++latestRequest;
    try {
      await cartApi.clear();
      if (request === latestRequest) set({ items: [], subtotal: 0, shipping: 0, shippingFaster: null, itemCount: 0, discount: 0, couponCode: null, isLoading: false, loaded: true, loadFailed: false });
    } catch (err) {
      if (request === latestRequest) set({ isLoading: false });
      console.error('clearCart error:', err?.response?.data || err?.message);
    }
  },

  // Clear cart locally only (after order placed). A read still on its way would bring the bought items back: it is dropped.
  clearCartLocal: () => {
    latestRequest += 1;
    set({ items: [], subtotal: 0, shipping: 0, shippingFaster: null, itemCount: 0, discount: 0, couponCode: null, isLoading: false, loaded: true, loadFailed: false });
  },

  // Cart drawer
  openCart: () => set({ isOpen: true }),
  closeCart: () => set({ isOpen: false }),
  toggleCart: () => set((s) => ({ isOpen: !s.isOpen })),
}));

export default useCartStore;

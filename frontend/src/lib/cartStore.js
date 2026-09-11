import { create } from 'zustand';
import { cartApi } from './api';

const useCartStore = create((set, get) => ({
  items: [],
  subtotal: 0,
  itemCount: 0,
  discount: 0,
  couponCode: null,
  isLoading: false,
  isOpen: false,

  // Fetch cart from server — only overwrites store if fetch succeeds
  fetchCart: async () => {
    set({ isLoading: true });
    try {
      const { data } = await cartApi.get();
      set({
        items: data.cart.items || [],
        subtotal: data.cart.subtotal || 0,
        itemCount: data.cart.itemCount || 0,
        discount: data.cart.discount || 0,
        couponCode: data.cart.couponCode || null,
        isLoading: false,
      });
    } catch (err) {
      // Don't wipe items on network error — keep whatever is in memory
      set({ isLoading: false });
      console.error('Failed to fetch cart:', err?.response?.data || err?.message || err);
    }
  },

  // Add item to cart
  addItem: async (slug, qty = 1) => {
    set({ isLoading: true });
    try {
      const { data } = await cartApi.add(slug, qty);
      set({
        items: data.cart.items,
        subtotal: data.cart.subtotal,
        itemCount: data.cart.itemCount,
        isLoading: false,
      });
      return { success: true };
    } catch (err) {
      set({ isLoading: false });
      const message = err.response?.data?.error || 'Failed to add to cart';
      console.error('addItem error:', err?.response?.data || err?.message);
      return { success: false, message };
    }
  },

  // Update item quantity
  updateItem: async (slug, qty) => {
    set({ isLoading: true });
    try {
      const { data } = await cartApi.update(slug, qty);
      set({
        items: data.cart.items,
        subtotal: data.cart.subtotal,
        itemCount: data.cart.itemCount,
        isLoading: false,
      });
    } catch (err) {
      set({ isLoading: false });
      console.error('updateItem error:', err?.response?.data || err?.message);
    }
  },

  // Remove item from cart
  removeItem: async (slug) => {
    set({ isLoading: true });
    try {
      const { data } = await cartApi.remove(slug);
      set({
        items: data.cart.items,
        subtotal: data.cart.subtotal,
        itemCount: data.cart.itemCount,
        isLoading: false,
      });
    } catch (err) {
      set({ isLoading: false });
      console.error('removeItem error:', err?.response?.data || err?.message);
    }
  },

  // Clear cart on server + locally
  clearCart: async () => {
    try {
      await cartApi.clear();
      set({ items: [], subtotal: 0, itemCount: 0, discount: 0, couponCode: null });
    } catch (err) {
      console.error('clearCart error:', err?.response?.data || err?.message);
    }
  },

  // Clear cart locally only (after order placed)
  clearCartLocal: () => {
    set({ items: [], subtotal: 0, itemCount: 0, discount: 0, couponCode: null });
  },

  // Cart drawer
  openCart: () => set({ isOpen: true }),
  closeCart: () => set({ isOpen: false }),
  toggleCart: () => set((s) => ({ isOpen: !s.isOpen })),
}));

export default useCartStore;

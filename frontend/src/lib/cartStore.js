import { create } from 'zustand';
import { cartApi } from './api';

// shippingFaster: the price of Faster shipping for this cart, null when it is not offered.
const EMPTY_CART = { items: [], subtotal: 0, shipping: 0, shippingFaster: null, itemCount: 0, discount: 0, couponCode: null };

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

// Cart answers can arrive in any order (the server can take seconds to wake up), and the order requests STARTED in says
// nothing about the order the server handled them in. So:
//  - a change (add, quantity, remove, clear) answers with the cart after that change: shown unless a later change was made;
//  - a read is shown only if it is the latest read, no change was on its way when it started, and none was made since
//    (whether it saw a change or not cannot be known, and the change's own answer is shown anyway);
//  - when changes overlapped, or the latest one failed, the cart is read once more after all of them are done: the
//    answer set aside could have been the newest, and a read set aside for a change that failed must not leave the page
//    out of date or waiting.
// isLoading counts requests on their way, so it cannot be left on.
let pending = 0;
let latestRead = 0;
let latestChange = 0;
let changesOnTheirWay = 0;
let rereadWhenSettled = false;

const useCartStore = create((set, get) => {
  const started = (extra = {}) => { pending += 1; set({ isLoading: true, ...extra }); };
  const finished = () => { pending -= 1; set({ isLoading: pending > 0 }); };

  // One change to the server's cart. Resolves to { ok: true } or { ok: false, err } and never throws.
  const change = async (send) => {
    if (changesOnTheirWay > 0) rereadWhenSettled = true;
    const mine = ++latestChange;
    changesOnTheirWay += 1;
    started();
    try {
      const { data } = await send();
      if (mine === latestChange) set(cartState(data.cart));
      return { ok: true };
    } catch (err) {
      if (mine === latestChange) rereadWhenSettled = true;
      return { ok: false, err };
    } finally {
      changesOnTheirWay -= 1;
      finished();
      if (changesOnTheirWay === 0 && rereadWhenSettled) {
        rereadWhenSettled = false;
        get().fetchCart();
      }
    }
  };

  return {
    ...EMPTY_CART,
    isLoading: false,
    loaded: false,     // the server's cart has been read (or changed) at least once since the page loaded
    loadFailed: false, // the last read failed: the cart pages offer to try again instead of saying the cart is empty
    isOpen: false,

    // Fetch cart from server — only overwrites store if fetch succeeds
    fetchCart: async () => {
      const read = ++latestRead;
      const changesBefore = latestChange;
      const startedClean = changesOnTheirWay === 0;
      const stillCurrent = () => read === latestRead && startedClean && changesBefore === latestChange;
      started({ loadFailed: false });
      try {
        const { data } = await cartApi.get();
        if (stillCurrent()) set(cartState(data.cart));
      } catch (err) {
        // Don't wipe items on network error — keep whatever is in memory
        if (stillCurrent()) set({ loadFailed: true });
        console.error('Failed to fetch cart:', err?.response?.data || err?.message || err);
      } finally {
        finished();
      }
    },

    // Add item to cart
    addItem: async (slug, qty = 1) => {
      const result = await change(() => cartApi.add(slug, qty));
      if (result.ok) return { success: true };
      console.error('addItem error:', result.err?.response?.data || result.err?.message);
      return { success: false, message: result.err?.response?.data?.error || 'Failed to add to cart' };
    },

    // Update item quantity
    updateItem: async (slug, qty) => {
      const result = await change(() => cartApi.update(slug, qty));
      if (result.ok) return { success: true };
      console.error('updateItem error:', result.err?.response?.data || result.err?.message);
      return { success: false, message: result.err?.response?.data?.error || 'Could not update the quantity' };
    },

    // Remove item from cart
    removeItem: async (slug) => {
      const result = await change(() => cartApi.remove(slug));
      if (!result.ok) console.error('removeItem error:', result.err?.response?.data || result.err?.message);
    },

    // Clear cart on server + locally
    clearCart: async () => {
      const result = await change(async () => {
        await cartApi.clear();
        return { data: { cart: EMPTY_CART } };
      });
      if (!result.ok) console.error('clearCart error:', result.err?.response?.data || result.err?.message);
    },

    // Clear cart locally only (after order placed). An answer still on its way would bring the bought items back: dropped.
    clearCartLocal: () => {
      latestRead += 1;
      latestChange += 1;
      rereadWhenSettled = false;
      set({ ...EMPTY_CART, loaded: true, loadFailed: false });
    },

    // Cart drawer
    openCart: () => set({ isOpen: true }),
    closeCart: () => set({ isOpen: false }),
    toggleCart: () => set((s) => ({ isOpen: !s.isOpen })),
  };
});

export default useCartStore;

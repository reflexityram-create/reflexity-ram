/**
 * store.jsx — Re-exports from the new API-backed stores for backward compatibility.
 * Cart and auth are now backed by the real API.
 * Recently viewed and saved-for-later remain local (no sensitive data).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Re-export new stores
export { default as useCartStore } from './cartStore';
export { default as useAuthStore } from './authStore';

// ─── Recently Viewed (local, non-sensitive) ───────────────────────────────────
export const useRecentlyViewed = create(
  persist(
    (set, get) => ({
      slugs: [],
      add: (slug) => {
        const filtered = get().slugs.filter((s) => s !== slug);
        set({ slugs: [slug, ...filtered].slice(0, 8) });
      },
    }),
    { name: 'reflexity-recent' },
  ),
);

// ─── Saved For Later (local) ──────────────────────────────────────────────────
export const useSavedForLater = create(
  persist(
    (set, get) => ({
      slugs: [],
      add: (slug) => {
        if (get().slugs.includes(slug)) return;
        set({ slugs: [slug, ...get().slugs] });
      },
      remove: (slug) => set({ slugs: get().slugs.filter((s) => s !== slug) }),
    }),
    { name: 'reflexity-saved' },
  ),
);

// Legacy useCart — wraps cartStore for backward compat with existing components
// New code should import useCartStore directly
import useCartStore from './cartStore';
export const useCart = useCartStore;

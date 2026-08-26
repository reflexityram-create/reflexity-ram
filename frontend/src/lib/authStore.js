import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authApi } from './api';
import { clearPersistedAuthSnapshot } from './authSession';

const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isLoading: false,
      isInitialized: false,

      // Initialize auth state from stored token.
      // Only clears the session on a definitive 401/403 (invalid/expired token).
      // Network errors (backend cold-start, timeout) preserve the persisted state
      // so the user is not logged out due to a transient connectivity issue.
      initialize: async () => {
        const token = localStorage.getItem('rfx_token');
        if (!token) {
          // Persist middleware can hydrate a user before this runs. Never retain
          // that stale principal when the corresponding bearer is gone.
          get().clearAuth();
          return;
        }
        try {
          const { data } = await authApi.me();
          set({ user: data.user, token, isInitialized: true });
        } catch (err) {
          const status = err.response?.status;
          if (status === 401 || status === 403) {
            // Token is definitively invalid or expired — clear the session
            console.warn('[Auth] Token rejected by server, clearing session');
            get().clearAuth();
          } else {
            // Network error, timeout, or backend cold-start — keep persisted state
            console.warn('[Auth] /me request failed (network/server error), keeping persisted session. Status:', status);
            const persisted = get();
            set({ isInitialized: true, user: persisted.user, token: persisted.token });
          }
        }
      },

      signup: async (data) => {
        set({ isLoading: true });
        try {
          const res = await authApi.signup(data);
          const { user, token } = res.data;
          localStorage.setItem('rfx_token', token);
          set({ user, token, isLoading: false });
          return { success: true, message: res.data.message };
        } catch (err) {
          set({ isLoading: false });
          const message = err.response?.data?.error || 'Signup failed';
          const details = err.response?.data?.details;
          return { success: false, message, details };
        }
      },

      login: async (data) => {
        set({ isLoading: true });
        try {
          const res = await authApi.login(data);
          const { user, token } = res.data;
          localStorage.setItem('rfx_token', token);
          set({ user, token, isLoading: false });
          return { success: true };
        } catch (err) {
          set({ isLoading: false });
          const message = err.response?.data?.error || 'Login failed';
          return { success: false, message };
        }
      },

      setGoogleAuth: (token, user) => {
        localStorage.setItem('rfx_token', token);
        set({ user, token, isLoading: false });
      },

      // This is intentionally synchronous: token expiry must remove both the
      // request credential and the persisted user before another admin route
      // can render from hydrated state.
      clearAuth: () => {
        clearPersistedAuthSnapshot();
        set({ user: null, token: null, isLoading: false, isInitialized: true });
      },

      logout: async () => {
        try {
          await authApi.logout();
        } catch {}
        get().clearAuth();
      },

      updateProfile: async (data) => {
        try {
          const res = await authApi.updateProfile(data);
          set({ user: res.data.user });
          return { success: true };
        } catch (err) {
          return { success: false, message: err.response?.data?.error || 'Update failed' };
        }
      },

      changePassword: async (data) => {
        try {
          await authApi.changePassword(data);
          return { success: true };
        } catch (err) {
          return { success: false, message: err.response?.data?.error || 'Failed to change password' };
        }
      },

      // Getters
      isAuthenticated: () => !!get().user,
      isAdmin: () => get().user?.role === 'admin',
    }),
    {
      name: 'rfx-auth',
      partialize: (state) => ({ user: state.user, token: state.token }),
    }
  )
);

export default useAuthStore;

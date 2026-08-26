export const AUTH_TOKEN_KEY = 'rfx_token';
export const AUTH_STORE_KEY = 'rfx-auth';

// Zustand rehydrates this small snapshot before React mounts. Removing only the
// bearer token leaves a previously persisted administrator visible until the
// next page load, so expiry clears both representations synchronously.
export function clearPersistedAuthSnapshot(storage = localStorage) {
  storage.removeItem(AUTH_TOKEN_KEY);

  const raw = storage.getItem(AUTH_STORE_KEY);
  if (!raw) return;

  try {
    const persisted = JSON.parse(raw);
    if (!persisted || typeof persisted !== 'object' || !persisted.state || typeof persisted.state !== 'object') {
      storage.removeItem(AUTH_STORE_KEY);
      return;
    }

    storage.setItem(AUTH_STORE_KEY, JSON.stringify({
      ...persisted,
      state: { ...persisted.state, user: null, token: null },
    }));
  } catch {
    // A malformed persisted snapshot is never a reason to retain an expired
    // principal. The store will recreate a clean snapshot on the next update.
    storage.removeItem(AUTH_STORE_KEY);
  }
}

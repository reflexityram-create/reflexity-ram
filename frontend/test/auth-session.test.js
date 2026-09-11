import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { clearPersistedAuthSnapshot } from '../src/lib/authSession.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

function fakeStorage(values = {}) {
  const entries = new Map(Object.entries(values));
  return {
    getItem: (key) => entries.has(key) ? entries.get(key) : null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: (key) => entries.delete(key),
  };
}

test('expired tokens synchronously clear the bearer and persisted principal', async () => {
  const [api, authStore, app] = await Promise.all([
    read('../src/lib/api.js'),
    read('../src/lib/authStore.js'),
    read('../src/App.jsx'),
  ]);
  const storage = fakeStorage({
    rfx_token: 'expired-token',
    'rfx-auth': JSON.stringify({
      state: {
        user: { id: 'admin-1', role: 'admin' },
        token: 'expired-token',
        unrelatedState: 'preserved',
      },
      version: 7,
      wrapperMetadata: { source: 'zustand' },
    }),
  });

  clearPersistedAuthSnapshot(storage);
  assert.equal(storage.getItem('rfx_token'), null);
  assert.deepEqual(JSON.parse(storage.getItem('rfx-auth')), {
    state: { user: null, token: null, unrelatedState: 'preserved' },
    version: 7,
    wrapperMetadata: { source: 'zustand' },
  });

  assert.match(api, /import \{ clearPersistedAuthSnapshot \} from '\.\/authSession'/);
  assert.match(api, /TOKEN_EXPIRED[\s\S]*?SESSION_REVOKED[\s\S]*?clearPersistedAuthSnapshot\(\);[\s\S]*?window\.dispatchEvent\(new CustomEvent\('auth:expired'\)\)/);
  assert.match(authStore, /import \{ clearPersistedAuthSnapshot \} from '\.\/authSession'/);
  assert.match(authStore, /clearAuth: \(\) => \{[\s\S]*?clearPersistedAuthSnapshot\(\);[\s\S]*?user: null, token: null,[\s\S]*?isInitialized: true/);
  assert.match(authStore, /if \(!token\) \{[\s\S]*?get\(\)\.clearAuth\(\);/);
  assert.match(authStore, /status === 401 \|\| status === 403[\s\S]*?get\(\)\.clearAuth\(\);/);
  assert.match(app, /const \{ initialize, clearAuth \} = useAuthStore\(\);/);
  assert.match(app, /const handler = \(\) => \{[\s\S]*?clearAuth\(\);[\s\S]*?auth:expired/);
  assert.match(app, /import \{ AUTH_TOKEN_KEY \} from "@\/lib\/authSession"/);
  assert.match(app, /const syncAuthTab = \(event\) => \{[\s\S]*?event\.key !== AUTH_TOKEN_KEY[\s\S]*?current\.user \|\| current\.token[\s\S]*?clearAuth\(\);[\s\S]*?current\.initialize\(\)/);
  assert.match(app, /window\.addEventListener\("storage", syncAuthTab\)[\s\S]*?window\.removeEventListener\("storage", syncAuthTab\)/);
});

test('malformed persisted auth snapshots are removed during expiry cleanup', () => {
  const storage = fakeStorage({ rfx_token: 'expired-token', 'rfx-auth': '{not json' });

  clearPersistedAuthSnapshot(storage);

  assert.equal(storage.getItem('rfx_token'), null);
  assert.equal(storage.getItem('rfx-auth'), null);
});

test('OAuth callback authenticates identity through /me and rejects query token fallback', async () => {
  const callback = await read('../src/pages/AuthCallback.jsx');

  assert.match(callback, /import \{ authApi \} from '@\/lib\/api'/);
  assert.match(callback, /const token = hash\.get\('token'\);/);
  assert.doesNotMatch(callback, /query\.get\('token'\)|query\.get\('user'\)/);
  assert.match(callback, /setAuthToken\(token\);[\s\S]*?await authApi\.me\(\);[\s\S]*?setAuthenticatedUser\(data\.user\)/);
  assert.match(callback, /catch \{[\s\S]*?clearAuth\(\);/);
});

test('password changes replace the revoked bearer in the active browser session', async () => {
  const [authStore, securityPage] = await Promise.all([
    read('../src/lib/authStore.js'),
    read('../src/pages/admin/Security.jsx'),
  ]);
  assert.match(authStore, /const token = response\.data\?\.token/);
  assert.match(authStore, /localStorage\.setItem\('rfx_token', token\)/);
  assert.match(authStore, /set\(\{ token \}\)/);
  assert.match(securityPage, /useAuthStore\(\(state\) => state\.changePassword\)/);
  assert.doesNotMatch(securityPage, /authApi\.changePassword/);
});

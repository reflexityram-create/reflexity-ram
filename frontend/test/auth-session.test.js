import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { clearPersistedAuthSnapshot } from '../src/lib/authSession.js';
import { parseCallbackUser } from '../src/lib/callbackUser.js';

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
  assert.match(api, /clearPersistedAuthSnapshot\(\);[\s\S]*?window\.dispatchEvent\(new CustomEvent\('auth:expired'\)\)/);
  assert.match(authStore, /import \{ clearPersistedAuthSnapshot \} from '\.\/authSession'/);
  assert.match(authStore, /clearAuth: \(\) => \{[\s\S]*?clearPersistedAuthSnapshot\(\);[\s\S]*?user: null, token: null,[\s\S]*?isInitialized: true/);
  assert.match(authStore, /if \(!token\) \{[\s\S]*?get\(\)\.clearAuth\(\);/);
  assert.match(authStore, /status === 401 \|\| status === 403[\s\S]*?get\(\)\.clearAuth\(\);/);
  assert.match(app, /const \{ initialize, clearAuth \} = useAuthStore\(\);/);
  assert.match(app, /const handler = \(\) => \{[\s\S]*?clearAuth\(\);[\s\S]*?auth:expired/);
  assert.match(app, /import \{ AUTH_TOKEN_KEY \} from "@\/lib\/authSession"/);
  assert.match(app, /const syncLoggedOutTab = \(event\) => \{[\s\S]*?event\.key !== AUTH_TOKEN_KEY \|\| localStorage\.getItem\(AUTH_TOKEN_KEY\)[\s\S]*?current\.user \|\| current\.token[\s\S]*?clearAuth\(\);/);
  assert.match(app, /window\.addEventListener\("storage", syncLoggedOutTab\)[\s\S]*?window\.removeEventListener\("storage", syncLoggedOutTab\)/);
});

test('malformed persisted auth snapshots are removed during expiry cleanup', () => {
  const storage = fakeStorage({ rfx_token: 'expired-token', 'rfx-auth': '{not json' });

  clearPersistedAuthSnapshot(storage);

  assert.equal(storage.getItem('rfx_token'), null);
  assert.equal(storage.getItem('rfx-auth'), null);
});

test('OAuth callback parses URLSearchParams-decoded JSON before a legacy decode fallback', async () => {
  const callback = await read('../src/pages/AuthCallback.jsx');

  const user = { firstName: '100% RAM', email: 'admin@reflexityram.com', role: 'admin' };
  const json = JSON.stringify(user);

  assert.deepEqual(parseCallbackUser(json), user);
  assert.deepEqual(parseCallbackUser(encodeURIComponent(json)), user);
  assert.equal(parseCallbackUser('null'), null);
  assert.equal(parseCallbackUser('[]'), null);
  assert.equal(parseCallbackUser('{malformed'), null);

  assert.match(callback, /import \{ parseCallbackUser \} from '@\/lib\/callbackUser'/);
  assert.match(callback, /const user = parseCallbackUser\(userRaw\);[\s\S]*?if \(!user\) throw new Error\('Invalid callback user'\);/);
});

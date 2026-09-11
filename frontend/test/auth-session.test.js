import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { clearPersistedAuthSnapshot } from "../src/lib/authSession.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

function fakeStorage(values = {}) {
  const entries = new Map(Object.entries(values));
  return {
    getItem: (key) => entries.has(key) ? entries.get(key) : null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: (key) => entries.delete(key),
  };
}

test("expired administrator tokens synchronously clear bearer, principal, and cross-tab state", async () => {
  const [api, authStore, app] = await Promise.all([
    read("../src/lib/api.js"), read("../src/lib/authStore.js"), read("../src/App.jsx"),
  ]);
  const storage = fakeStorage({
    rfx_token: "expired-token",
    "rfx-auth": JSON.stringify({ state: { user: { id: "admin-1", role: "admin" }, token: "expired-token", preserved: true }, version: 7 }),
  });
  clearPersistedAuthSnapshot(storage);
  assert.equal(storage.getItem("rfx_token"), null);
  assert.deepEqual(JSON.parse(storage.getItem("rfx-auth")), {
    state: { user: null, token: null, preserved: true }, version: 7,
  });
  assert.match(api, /TOKEN_EXPIRED[\s\S]*SESSION_REVOKED[\s\S]*clearPersistedAuthSnapshot\(\)[\s\S]*auth:expired/);
  assert.match(authStore, /clearAuth: \(\) => \{[\s\S]*clearPersistedAuthSnapshot\(\)[\s\S]*user: null, token: null,[\s\S]*isInitialized: true/);
  assert.match(authStore, /if \(!token\) \{[\s\S]*get\(\)\.clearAuth\(\)/);
  assert.match(authStore, /status === 401 \|\| status === 403[\s\S]*get\(\)\.clearAuth\(\)/);
  assert.match(app, /const syncAuthTab = \(event\) => \{[\s\S]*event\.key !== AUTH_TOKEN_KEY[\s\S]*current\.user \|\| current\.token[\s\S]*clearAuth\(\)[\s\S]*current\.initialize\(\)/);
  assert.match(app, /window\.addEventListener\("storage", syncAuthTab\)[\s\S]*window\.removeEventListener\("storage", syncAuthTab\)/);
});

test("malformed persisted auth snapshots are removed during expiry cleanup", () => {
  const storage = fakeStorage({ rfx_token: "expired-token", "rfx-auth": "{not json" });
  clearPersistedAuthSnapshot(storage);
  assert.equal(storage.getItem("rfx_token"), null);
  assert.equal(storage.getItem("rfx-auth"), null);
});

test("OAuth only accepts a fragment bearer, replaces it, verifies identity, and rejects non-admins", async () => {
  const [callback, app, signIn] = await Promise.all([
    read("../src/pages/AuthCallback.jsx"), read("../src/App.jsx"), read("../src/pages/AdminSignIn.jsx"),
  ]);
  assert.match(callback, /const token = hash\.get\("token"\)/);
  assert.doesNotMatch(callback, /query\.get\("token"\)|query\.get\("user"\)/);
  assert.match(callback, /window\.history\.replaceState\(\{\}, "", "\/auth\/callback"\)/);
  assert.match(callback, /setAuthToken\(token\);[\s\S]*await authApi\.me\(\)[\s\S]*data\?\.user\?\.role !== "admin"[\s\S]*setAuthenticatedUser\(data\.user\)/);
  assert.match(callback, /catch \{[\s\S]*clearAuth\(\)[\s\S]*navigate\("\/admin\/sign-in"/);
  assert.match(app, /path="\/admin\/sign-in"[\s\S]*path="\/auth\/callback"[\s\S]*path="\/reset-password"/);
  assert.match(signIn, /login\(\{ email, password \}\)/);
  assert.doesNotMatch(signIn, /signup|Create account/i);
});

test("password changes replace a revoked active bearer without exposing a public account route", async () => {
  const [authStore, securityPage, appLayout] = await Promise.all([
    read("../src/lib/authStore.js"), read("../src/pages/admin/Security.jsx"), read("../src/components/AppLayout.jsx"),
  ]);
  assert.match(authStore, /const token = response\.data\?\.token/);
  assert.match(authStore, /localStorage\.setItem\('rfx_token', token\)/);
  assert.match(authStore, /set\(\{ token \}\)/);
  assert.match(securityPage, /useAuthStore\(\(state\) => state\.changePassword\)/);
  assert.doesNotMatch(securityPage, /authApi\.changePassword/);
  assert.match(appLayout, /Navigate to="\/admin\/sign-in"/);
  assert.doesNotMatch(appLayout, /\/account/);
});

test("retired public account and retail client helpers are not retained by the admin shell", async () => {
  const [api, authStore, adminLayout, products] = await Promise.all([
    read("../src/lib/api.js"), read("../src/lib/authStore.js"), read("../src/components/AdminLayout.jsx"), read("../src/pages/admin/Products.jsx"),
  ]);
  for (const source of [api, authStore]) assert.doesNotMatch(source, /signup|updateProfile|setGoogleAuth/);
  assert.doesNotMatch(api, /reviewsApi|cartApi|ordersApi|stripeApi/);
  await assert.rejects(read("../src/lib/useStock.js"), { code: "ENOENT" });
  assert.match(adminLayout, /View site/);
  assert.doesNotMatch(adminLayout, /View store/);
  assert.match(products, /title="View inventory item"/);
  assert.doesNotMatch(products, /View on store/);
});

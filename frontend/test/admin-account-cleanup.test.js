import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

// The store has a handful of products, users and orders; the owner asked for the search boxes to go.
test('admin products, wholesale, orders and users have no search box', async () => {
  for (const page of ['Products', 'WholesaleAdmin', 'Orders', 'Users']) {
    const source = await read(`../src/pages/admin/${page}.jsx`);
    assert.doesNotMatch(source, /placeholder="Search|aria-label="Search|<Search\b|handleSearch/, `${page} still has a search box`);
  }
});

// There are no phone codes, and "Role: admin" told the owner nothing.
test('account settings have no phone field and the profile shows no role', async () => {
  const account = await read('../src/pages/Account.jsx');
  assert.doesNotMatch(account, /Phone number|profileForm\.phone/);
  assert.doesNotMatch(account, /\{user\.role\}|>Role</);
  assert.match(account, /\{tab === 'profile' && !isAdmin && \(/);
});

// Email verification matters for customers, not for the store's admins.
test('the email verification card and banner are for customers only', async () => {
  const account = await read('../src/pages/Account.jsx');
  assert.match(account, /\{user && !isAdmin && !user\.isEmailVerified && \(/);
  const layout = await read('../src/components/AppLayout.jsx');
  assert.match(layout, /label: 'Profile', icon: User, customerOnly: true/);
});

// Google-only accounts have no current password, so the change-password form could never work for them.
test('accounts without a password get no change-password form', async () => {
  const [layout, account] = await Promise.all([read('../src/components/AppLayout.jsx'), read('../src/pages/Account.jsx')]);
  assert.match(layout, /label: 'Security', icon: Shield, passwordOnly: true/);
  assert.match(layout, /!\(i\.passwordOnly && user\.hasPassword === false\)/);
  assert.match(account, /\{tab === 'security' && user\.hasPassword === false && \(/);
  assert.match(account, /\{tab === 'security' && user\.hasPassword !== false && \(/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV ||= 'test';
process.env.JWT_SECRET ||= 'auth-me-unit-test-secret';

const User = require('../src/models/User');
const authRouter = require('../src/routes/auth');

async function me(userDoc, passwordStored) {
  const originals = [User.findById, User.exists];
  User.findById = () => ({ select: async () => userDoc });
  User.exists = async (filter) => (passwordStored && String(filter._id) === String(userDoc._id) ? { _id: userDoc._id } : null);
  const app = express();
  app.use('/api/auth', authRouter);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const token = jwt.sign({ id: String(userDoc._id), av: 0 }, process.env.JWT_SECRET);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
    [User.findById, User.exists] = originals;
  }
}

const account = (extra = {}) => new User({ email: 'owner@example.com', firstName: 'Owner', lastName: 'Test', role: 'admin', ...extra });

// "Change password" needs a current password; accounts made with Google have none,
// so the account page hides it when /me says hasPassword is false.
test('/me tells the account page whether the account has a password', async () => {
  const google = await me(account({ googleId: 'google-123' }), false);
  assert.equal(google.status, 200);
  assert.equal(google.body.user.hasPassword, false);
  assert.equal(google.body.user.email, 'owner@example.com');

  const withPassword = await me(account(), true);
  assert.equal(withPassword.body.user.hasPassword, true);
  assert.equal('password' in withPassword.body.user, false, 'the password never leaves the server');
});

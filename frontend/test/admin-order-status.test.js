import assert from 'node:assert/strict';
import test from 'node:test';
import { statusOptions } from '../src/lib/adminOrderStatus.js';

test('paid orders can ship from pending but cannot be manually cancelled', () => {
  assert.deepEqual(statusOptions({ status: 'pending', paymentStatus: 'paid' }), ['pending', 'processing', 'shipped']);
});

test('unpaid orders can be cancelled but cannot be processed or shipped', () => {
  assert.deepEqual(statusOptions({ status: 'pending', paymentStatus: 'pending' }), ['pending', 'cancelled']);
  assert.deepEqual(statusOptions({ status: 'processing', paymentStatus: 'failed' }), ['processing', 'cancelled']);
});

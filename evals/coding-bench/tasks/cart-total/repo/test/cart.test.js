import { test } from 'node:test';
import assert from 'node:assert/strict';
import { total } from '../src/cart.js';

test('sums price times quantity', () => {
  assert.equal(total([{ price: 2.5, quantity: 2 }, { price: 1, quantity: 3 }]), 8);
});
test('applies the discount and rounds', () => {
  assert.equal(total([{ price: 9.99, quantity: 3 }], 10), 26.97);
});
test('an empty cart is 0', () => assert.equal(total([]), 0));

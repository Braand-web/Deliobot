import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paginate } from '../src/paginate.js';

const items = Array.from({ length: 7 }, (_, i) => i + 1);
test('first page', () => assert.deepEqual(paginate(items, 1, 3), { items: [1, 2, 3], pages: 3 }));
test('last partial page', () => assert.deepEqual(paginate(items, 3, 3), { items: [7], pages: 3 }));
test('empty list has no pages', () => assert.deepEqual(paginate([], 1, 3), { items: [], pages: 0 }));

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStock } from '../src/stock.js';

test('reserves what there is', () => { const s = createStock({ tee: 2 }); assert.equal(s.reserve('tee', 2), true); assert.equal(s.left('tee'), 0); });
test('refuses more than there is, changing nothing', () => { const s = createStock({ tee: 1 }); assert.equal(s.reserve('tee', 2), false); assert.equal(s.left('tee'), 1); });
test('unknown item', () => { const s = createStock({}); assert.equal(s.reserve('cap', 1), false); });
test('refuses zero or negative', () => { const s = createStock({ tee: 3 }); assert.equal(s.reserve('tee', 0), false); assert.equal(s.reserve('tee', -1), false); assert.equal(s.left('tee'), 3); });

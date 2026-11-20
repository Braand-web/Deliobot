import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromRoman, toRoman } from '../src/roman.js';

test('to roman', () => { assert.equal(toRoman(1994), 'MCMXCIV'); assert.equal(toRoman(3999), 'MMMCMXCIX'); assert.equal(toRoman(4), 'IV'); });
test('from roman', () => { assert.equal(fromRoman('MCMXCIV'), 1994); assert.equal(fromRoman('XLII'), 42); });
test('round trip', () => { for (let n = 1; n < 4000; n += 37) assert.equal(fromRoman(toRoman(n)), n); });
test('range and validity', () => { assert.throws(() => toRoman(0)); assert.throws(() => toRoman(4000)); assert.throws(() => fromRoman('IIII')); assert.throws(() => fromRoman('ABC')); });

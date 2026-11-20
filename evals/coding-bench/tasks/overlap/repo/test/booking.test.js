import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overlaps } from '../src/booking.js';

test('touching is free', () => assert.equal(overlaps({ start: 60, end: 120 }, { start: 120, end: 180 }), false));
test('inside overlaps', () => assert.equal(overlaps({ start: 0, end: 600 }, { start: 60, end: 120 }), true));
test('partial overlap', () => assert.equal(overlaps({ start: 100, end: 200 }, { start: 150, end: 250 }), true));
test('apart', () => assert.equal(overlaps({ start: 0, end: 10 }, { start: 20, end: 30 }), false));

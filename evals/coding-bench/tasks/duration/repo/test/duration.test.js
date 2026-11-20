import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration } from '../src/duration.js';

test('hours and minutes', () => assert.equal(parseDuration('1h30m'), 5400));
test('spaces and seconds', () => assert.equal(parseDuration('2h 5m 10s'), 7510));
test('seconds only', () => assert.equal(parseDuration('45s'), 45));
test('throws on garbage', () => assert.throws(() => parseDuration('soon')));
test('throws on empty', () => assert.throws(() => parseDuration('')));

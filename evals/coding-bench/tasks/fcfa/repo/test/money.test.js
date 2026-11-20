import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatFcfa } from '../src/money.js';

test('groups thousands', () => assert.equal(formatFcfa(1234567), '1 234 567 FCFA'));
test('small', () => assert.equal(formatFcfa(500), '500 FCFA'));
test('rounds', () => assert.equal(formatFcfa(999.6), '1 000 FCFA'));
test('negative', () => assert.equal(formatFcfa(-25000), '-25 000 FCFA'));

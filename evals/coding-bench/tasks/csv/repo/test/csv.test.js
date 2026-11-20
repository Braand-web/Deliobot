import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/csv.js';

test('plain rows', () => assert.deepEqual(parseCsv('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]));
test('quoted commas and quotes', () => assert.deepEqual(parseCsv('name,note\n"Diop, Awa","says ""hi"""'), [['name', 'note'], ['Diop, Awa', 'says "hi"']]));
test('windows line endings', () => assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]));
test('empty fields', () => assert.deepEqual(parseCsv('a,,c'), [['a', '', 'c']]));

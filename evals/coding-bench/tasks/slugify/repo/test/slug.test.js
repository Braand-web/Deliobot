import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/slug.js';

test('removes accents and joins with dashes', () => assert.equal(slugify('Crème Brûlée à Dakar'), 'creme-brulee-a-dakar'));
test('collapses symbols and trims dashes', () => assert.equal(slugify('  --Hello, World!!  '), 'hello-world'));
test('keeps digits', () => assert.equal(slugify('Top 10 Apps 2026'), 'top-10-apps-2026'));

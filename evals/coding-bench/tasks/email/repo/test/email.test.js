import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEmail } from '../src/email.js';

test('accepts', () => { for (const ok of ['awa@example.com', 'a.b+tag@mail.example.sn']) assert.equal(isEmail(ok), true, ok); });
test('refuses', () => { for (const bad of ['@example.com', 'awa@', 'awa@example', 'a wa@example.com', 'a@@example.com', 'awa@.com', 'awa@example.']) assert.equal(isEmail(bad), false, bad); });

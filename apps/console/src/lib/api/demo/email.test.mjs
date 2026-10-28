// node --experimental-strip-types --test src/lib/api/demo/email.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeEmail } from './email.ts';

test('accepts ordinary addresses, including ones with the letter s', () => {
  for (const a of ['sam@example.com', 'jess.smith@stone-dental.co', 'owner@ssss.sss']) assert.equal(looksLikeEmail(a), true, a);
});
test('refuses an address with a space', () => {
  for (const a of ['sam smith@example.com', 'sam@exa mple.com', ' sam@example.com']) assert.equal(looksLikeEmail(a), false, a);
});
test('refuses an address with no dot after the at sign, and a literal-dot lookalike', () => {
  for (const a of ['sam@example', 'sam@examplecom', 'sam@@example.com', '@example.com', 'sam@.com']) assert.equal(looksLikeEmail(a), false, a);
});
test('refuses an address over 200 characters', () => assert.equal(looksLikeEmail('a'.repeat(200) + '@x.co'), false));

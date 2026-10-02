// node --experimental-strip-types --test src/lib/safe-next.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeNext } from './safe-next.ts';

const O = 'https://suite.omnisdr.com';

test('safeNext keeps a path on this origin', () => {
  for (const p of ['/', '/w/abc/home', '/invite/abcdefghijklmnop', '/w/x/connections?tab=mail#gmail']) assert.equal(safeNext(p, O), p);
});

test('safeNext refuses anything that leaves the origin, including what the URL parser strips (PR #34 audit P2)', () => {
  // What a browser does with each payload, so the test pins the real bypass and not a guess at it.
  for (const p of ['/\t/evil.example', '/\n/evil.example', '/\r/evil.example', '/\\evil.example', '/\\/evil.example']) {
    assert.equal(new URL(p, O).origin, 'https://evil.example', JSON.stringify(p));
  }
  const bad = ['/\t/evil.example', '/\n/evil.example', '/\r/evil.example', '//evil.example', '/\\evil.example', '/\\/evil.example',
    'https://evil.example/', 'javascript:alert(1)', ' /x', '', null, undefined, '/\u0000/evil.example', '/\u007f/evil.example'];
  for (const p of bad) assert.equal(safeNext(p, O), '/', JSON.stringify(p));
});

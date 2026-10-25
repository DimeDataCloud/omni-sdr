// Self-test for scripts/ci-local.mjs (B-1b): an unknown --only name fails the run, and --strict fails a skipped test.
// Runs the real script against a throwaway tree (the script resolves its root from its own location), with --skip-install
// so nothing is installed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'ci-local.mjs');
let root;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'ci-local-selftest-'));
  mkdirSync(join(root, 'scripts'));
  copyFileSync(SCRIPT, join(root, 'scripts', 'ci-local.mjs'));
  const pkg = (name, testFile) => {
    const dir = join(root, 'packages', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, private: true, scripts: { test: 'node --test' } }));
    writeFileSync(join(dir, 'a.test.mjs'), testFile);
  };
  pkg('zz-ok', `import { test } from 'node:test'; test('passes', () => {});`);
  pkg('zz-skip', `import { test } from 'node:test'; test('passes', () => {}); test.skip('skipped', () => {});`);
});
after(() => rmSync(root, { recursive: true, force: true }));

// NODE_TEST_CONTEXT is set while this file runs under node --test; left in, the inner node --test prints no summary.
const run = (...args) => spawnSync(process.execPath, [join(root, 'scripts', 'ci-local.mjs'), '--skip-install', ...args], { encoding: 'utf8', timeout: 120000, env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
const out = (r) => `${r.stdout}${r.stderr}`;

test('a passing package passes', () => {
  const r = run('--only', 'zz-ok');
  assert.equal(r.status, 0, out(r));
  assert.match(out(r), /ALL PASS/);
});

test('--only with an unknown name exits 1 and names it, even when another name is valid', () => {
  for (const only of ['zz-typo', 'zz-ok,zz-typo']) {
    const r = run('--only', only);
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /unknown package zz-typo/);
    assert.doesNotMatch(out(r), /ALL PASS/);
  }
});

test('a skipped test passes by default and fails under --strict', () => {
  const lax = run('--only', 'zz-skip');
  assert.equal(lax.status, 0, out(lax));
  const strict = run('--strict', '--only', 'zz-skip');
  assert.equal(strict.status, 1, out(strict));
  assert.match(out(strict), /--strict: 1 skipped/);
  assert.match(out(strict), /FAILED: test packages\/zz-skip/);
});

test('--strict does not fail a clean package', () => {
  assert.equal(run('--strict', '--only', 'zz-ok').status, 0);
});

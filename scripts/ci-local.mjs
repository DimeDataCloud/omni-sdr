// RUN GATES ONLY UNDER ops-run (node C:/Users/cdsec/omnisdr-ops/bin/ops-run.mjs): it kills the whole process tree on a
// timeout and scrubs the environment. This script's own timeout uses spawnSync with shell: true, and on Windows that kill
// reaches the shell but NOT the npm/node children under it, so a hung test can outlive a timed-out run.
//
// Local merge gate: the same checks as .github/workflows/tests.yml, run on this machine, ONE PACKAGE AT A TIME (a
// parallel run exhausts memory here). Use it when GitHub Actions cannot run.
//
//   node scripts/ci-local.mjs                    install every package that has a lockfile, then test them all
//   node scripts/ci-local.mjs --skip-install     test only (node_modules already match the lockfiles)
//   node scripts/ci-local.mjs --only api,db      only these (names are the folder under packages/ or edge/)
//   node scripts/ci-local.mjs --list             print what would run and stop
//   node scripts/ci-local.mjs --strict           gate runs: any skipped or todo test is a FAIL
//
// --only with a name that matches no testable package exits 1 and names it (a typo must not turn a split gate green).
//
// What it mirrors from the workflow:
//   discovery  every packages/* and edge/* folder whose package.json has a `test` script
//   install    `npm ci` in every packages/* and edge/* folder that has a package-lock.json (packages import each
//              other's test helpers, so all of them are installed before any is tested)
//   test       `npm test` in each discovered package
// Folders with a test script but NO lockfile (today packages/ai and edge/api-proxy) have no dependencies either, so
// there is nothing to install: they are skipped for the install step, and tested like the rest. If one ever gains
// dependencies without a lockfile, this script stops and says so instead of guessing.
//
// A package FAILS when it times out (15 minutes, per package and per install; CI_LOCAL_TIMEOUT_MS overrides, for the
// failure proof only), or when its test run reports 0 tests or no readable test count (a runner that ran nothing must
// not look like a pass).
//
// Output: each package's full log goes to <os tmp>/ci-local/<root>-<name>.log; the table below is what to paste into a
// PR. Exit code is 0 only if every install and every test passed.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['packages', 'edge'];
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const only = args.includes('--only') ? new Set(String(args[args.indexOf('--only') + 1] ?? '').split(',').filter(Boolean)) : null;
const LOGS = join(tmpdir(), 'ci-local');
const TIMEOUT_MS = Number(process.env.CI_LOCAL_TIMEOUT_MS) || 15 * 60 * 1000;

const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));

/** Every packages/* and edge/* folder with a package.json, sorted like the workflow's discover job. */
export function discover(root = ROOT) {
  const out = [];
  for (const r of ROOTS) {
    if (!existsSync(join(root, r))) continue;
    for (const name of readdirSync(join(root, r)).sort()) {
      const file = join(root, r, name, 'package.json');
      if (!existsSync(file)) continue;
      const pkg = readJson(file);
      out.push({ dir: `${r}/${name}`, name, abs: join(root, r, name), hasTest: !!pkg.scripts?.test,
        hasLock: existsSync(join(root, r, name, 'package-lock.json')),
        hasDeps: Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length > 0 });
    }
  }
  return out;
}

function run(cwd, cmd, argv, logName) {
  mkdirSync(LOGS, { recursive: true });
  const started = Date.now();
  // shell: true so `npm` resolves to npm.cmd on Windows.
  const r = spawnSync(cmd, argv, { cwd, shell: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: process.env, timeout: TIMEOUT_MS, killSignal: 'SIGKILL' });
  const timedOut = r.error?.code === 'ETIMEDOUT' || r.signal !== null;
  const log = join(LOGS, `${logName}.log`);
  writeFileSync(log, `$ ${cmd} ${argv.join(' ')}\n${r.stdout ?? ''}\n${r.stderr ?? ''}\n${timedOut ? `TIMEOUT after ${TIMEOUT_MS / 1000}s\n` : ''}exit ${r.status}\n`);
  return { ok: r.status === 0 && !timedOut, timedOut, secs: (Date.now() - started) / 1000, log, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`node ${process.version}`);
const all = discover();
if (only) {
  const unknown = [...only].filter((n) => !all.some((p) => p.hasTest && (p.name === n || p.dir === n)));
  if (unknown.length) { console.error(`--only: unknown package ${unknown.join(', ')} (testable: ${all.filter((p) => p.hasTest).map((p) => p.name).join(', ')})`); process.exit(1); }
}
const testable = all.filter((p) => p.hasTest && (!only || only.has(p.name) || only.has(p.dir)));
if (!testable.length) { console.error('no package with a test script found'); process.exit(1); }

// A package with a test script, dependencies and no lockfile cannot be reproduced: stop rather than guess.
const unlocked = testable.filter((p) => p.hasDeps && !p.hasLock);
if (unlocked.length) { console.error(`dependencies but no lockfile: ${unlocked.map((p) => p.dir).join(', ')}. Add a package-lock.json.`); process.exit(1); }

if (flag('--list')) {
  console.log(`install (npm ci): ${all.filter((p) => p.hasLock).map((p) => p.dir).join(', ') || 'none'}`);
  console.log(`skip install (no lockfile, no dependencies): ${all.filter((p) => !p.hasLock).map((p) => p.dir).join(', ') || 'none'}`);
  console.log(`test: ${testable.map((p) => p.dir).join(', ')}`);
  process.exit(0);
}

const rows = [];
if (!flag('--skip-install')) {
  for (const p of all.filter((x) => x.hasLock)) {
    process.stdout.write(`npm ci   ${p.dir} ... `);
    const r = run(p.abs, 'npm', ['ci'], `install-${p.name}`);
    console.log(r.ok ? `ok (${r.secs.toFixed(1)}s)` : 'FAILED');
    rows.push({ step: 'install', dir: p.dir, ...r });
    if (!r.ok) console.log(r.out.split('\n').slice(-15).join('\n'));
  }
}
const installFailed = rows.some((r) => !r.ok);
if (installFailed) console.log('\ninstall failed: not running tests on a broken install');
else {
  for (const p of testable) {
    process.stdout.write(`npm test ${p.dir} ... `);
    const r = run(p.abs, 'npm', ['test'], `test-${p.name}`);
    // The node:test summary lines, for the table.
    const counts = ['tests', 'pass', 'fail', 'skipped'].map((k) => new RegExp(`^ℹ ${k} (\\d+)`, 'm').exec(r.out)?.[1] ?? '?');
    const summary = counts.join('/');
    // exit 0 with no tests, or with no readable count, is not a pass.
    const todo = Number(/^ℹ todo (\d+)/m.exec(r.out)?.[1] ?? 0);
    const skippedN = Number(counts[3] === '?' ? 0 : counts[3]);
    const lax = r.ok && flag('--strict') && (skippedN > 0 || todo > 0);
    const empty = r.ok && (counts[0] === '?' || Number(counts[0]) === 0);
    const ok = r.ok && !empty && !lax;
    console.log(ok ? `ok (${r.secs.toFixed(1)}s)` : r.timedOut ? 'FAILED (timeout)' : lax ? `FAILED (--strict: ${skippedN} skipped, ${todo} todo)` : empty ? 'FAILED (0 tests or no count)' : 'FAILED');
    rows.push({ step: 'test', dir: p.dir, summary, ...r, ok });
    if (!ok) console.log(r.out.split('\n').slice(-40).join('\n'));
  }
}

console.log(`\n${pad('step', 8)}${pad('package', 28)}${pad('result', 8)}${pad('secs', 8)}${pad('tests/pass/fail/skip', 24)}log`);
for (const r of rows) console.log(`${pad(r.step, 8)}${pad(r.dir, 28)}${pad(r.ok ? 'PASS' : 'FAIL', 8)}${pad(r.secs.toFixed(1), 8)}${pad(r.summary ?? '', 24)}${r.log}`);
const failed = rows.filter((r) => !r.ok);
console.log(failed.length || installFailed ? `\nFAILED: ${failed.map((r) => `${r.step} ${r.dir}`).join(', ')}` : '\nALL PASS');
process.exit(failed.length || installFailed ? 1 : 0);

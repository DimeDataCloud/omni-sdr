// Local merge gate: the same checks as .github/workflows/tests.yml, run on this machine, ONE PACKAGE AT A TIME (a
// parallel run exhausts memory here). Use it when GitHub Actions cannot run.
//
//   node scripts/ci-local.mjs                    install every package that has a lockfile, then test them all
//   node scripts/ci-local.mjs --skip-install     test only (node_modules already match the lockfiles)
//   node scripts/ci-local.mjs --only api,db      only these (names are the folder under packages/ or edge/)
//   node scripts/ci-local.mjs --list             print what would run and stop
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
  const r = spawnSync(cmd, argv, { cwd, shell: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: process.env });
  const log = join(LOGS, `${logName}.log`);
  writeFileSync(log, `$ ${cmd} ${argv.join(' ')}\n${r.stdout ?? ''}\n${r.stderr ?? ''}\nexit ${r.status}\n`);
  return { ok: r.status === 0, secs: (Date.now() - started) / 1000, log, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const pad = (s, n) => String(s).padEnd(n);
const all = discover();
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
    console.log(r.ok ? `ok (${r.secs.toFixed(1)}s)` : 'FAILED');
    // The node:test summary lines, for the table.
    const summary = ['tests', 'pass', 'fail', 'skipped'].map((k) => new RegExp(`^ℹ ${k} (\\d+)`, 'm').exec(r.out)?.[1] ?? '?').join('/');
    rows.push({ step: 'test', dir: p.dir, summary, ...r });
    if (!r.ok) console.log(r.out.split('\n').slice(-40).join('\n'));
  }
}

console.log(`\n${pad('step', 8)}${pad('package', 28)}${pad('result', 8)}${pad('secs', 8)}${pad('tests/pass/fail/skip', 24)}log`);
for (const r of rows) console.log(`${pad(r.step, 8)}${pad(r.dir, 28)}${pad(r.ok ? 'PASS' : 'FAIL', 8)}${pad(r.secs.toFixed(1), 8)}${pad(r.summary ?? '', 24)}${r.log}`);
const failed = rows.filter((r) => !r.ok);
console.log(failed.length || installFailed ? `\nFAILED: ${failed.map((r) => `${r.step} ${r.dir}`).join(', ')}` : '\nALL PASS');
process.exit(failed.length || installFailed ? 1 : 0);

// The production entry refuses to start without OMNI_APP_URL and OMNI_UNSUBSCRIBE_BASE (the old defaults pointed at a
// host with no DNS record). Spawned for real: the check is a process.exit in server.mjs, not something a unit can call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('../src/server.mjs', import.meta.url));
// Scrubbed environment: nothing from the developer's shell leaks in. The pool is lazy, so no database is needed.
const BASE = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DATABASE_URL: 'postgres://u:p@127.0.0.1:1/none',
  ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'aud-tag', PORT: '8831' };

function start(env) {
  const child = spawn(process.execPath, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
  const exited = new Promise((res) => child.on('exit', (code) => { clearTimeout(timer); res(code); }));
  return { child, exited, output: () => out };
}

for (const missing of ['OMNI_APP_URL', 'OMNI_UNSUBSCRIBE_BASE']) {
  test(`the API exits 1 and names ${missing} when it is not set`, async () => {
    const env = { ...BASE, OMNI_APP_URL: 'https://app.example.test', OMNI_UNSUBSCRIBE_BASE: 'https://api.example.test' };
    delete env[missing];
    const p = start(env);
    const code = await p.exited;
    assert.equal(code, 1, p.output());
    assert.match(p.output(), new RegExp(`missing ${missing}`));
  });
}

test('control: with both set the API starts and listens (so the refusals above are about the missing variable)', async () => {
  const p = start({ ...BASE, OMNI_APP_URL: 'https://app.example.test', OMNI_UNSUBSCRIBE_BASE: 'https://api.example.test' });
  const deadline = Date.now() + 15000;
  while (!/listening on 8831/.test(p.output()) && p.child.exitCode === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  const ok = /listening on 8831/.test(p.output());
  const out = p.output();
  p.child.kill('SIGKILL');
  await p.exited;
  assert.ok(ok, out);
});

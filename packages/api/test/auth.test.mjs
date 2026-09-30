import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHmac, createPrivateKey } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyIdToken, staticKeySource, googleKeySource, AuthError } from '../src/auth.mjs';
import { signJwt, claimsFor, KEYS, PROJECT } from './helpers.mjs';

const getKey = staticKeySource(KEYS);
const verify = (tok) => verifyIdToken(tok, { projectId: PROJECT, getKey });
const reason = async (p) => { try { await p; return 'accepted'; } catch (e) { assert.ok(e instanceof AuthError, e.message); return e.reason; } };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

test('a valid token yields the uid and a lower-cased email', async () => {
  assert.deepEqual(await verify(signJwt(claimsFor('Maya@Example.com'))), { uid: 'dev:Maya@Example.com', email: 'maya@example.com' });
});

test('every rule refuses its own violation (each case alone)', async () => {
  const now = Math.floor(Date.now() / 1000);
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const good = claimsFor('maya@example.com');
  const cases = [
    ['expired', signJwt({ ...good, exp: now - 120 })],
    ['wrong audience', signJwt({ ...good, aud: 'someone-else' })],
    ['wrong issuer', signJwt({ ...good, iss: 'https://securetoken.google.com/someone-else' })],
    ['issued in the future', signJwt({ ...good, iat: now + 600 })],
    ['authenticated in the future', signJwt({ ...good, auth_time: now + 600 })],
    ['no subject', signJwt({ ...good, sub: '' })],
    ['no subject', signJwt({ ...good, sub: 'x'.repeat(129) })],
    ['email not verified', signJwt({ ...good, email_verified: false })],
    ['email not verified', signJwt({ ...good, email: undefined })],
    ['bad signature', signJwt(good, { key: other })],
    ['unknown key id', signJwt(good, { kid: 'k2' })],
    ['wrong algorithm', `${b64({ alg: 'none', kid: 'k1' })}.${b64(good)}.`],
    // HS256 "key confusion": an HMAC signed with the public key must not pass as RS256.
    ['wrong algorithm', (() => {
      const h = b64({ alg: 'HS256', kid: 'k1' }); const p = b64(good);
      const pem = KEYS.k1.export({ type: 'spki', format: 'pem' });
      return `${h}.${p}.${createHmac('sha256', pem).update(`${h}.${p}`).digest('base64url')}`;
    })()],
    ['malformed token', 'a.b'],
    ['malformed token', 'not-a-jwt'],
    ['malformed token', 'x'.repeat(9000)],
  ];
  for (const [want, tok] of cases) assert.equal(await reason(verify(tok)), want, want);
  // Positive control in the same run, so the refusals above aren't a broken verifier refusing everything.
  assert.equal(await reason(verify(signJwt(good))), 'accepted');
  // A payload edited after signing fails the signature.
  const [h, , s] = signJwt(good).split('.');
  assert.equal(await reason(verify(`${h}.${b64({ ...good, email: 'attacker@example.com' })}.${s}`)), 'bad signature');
});

// Real X.509 certs, made at test time with openssl (no key material in the repo), served by a fake fetch
// the way Google serves them: { kid: PEM } plus Cache-Control max-age.
function makeCert(dir, name) {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=omni-test',
    '-keyout', join(dir, `${name}.key`), '-out', join(dir, `${name}.pem`)], { stdio: 'ignore' });
  return { cert: readFileSync(join(dir, `${name}.pem`), 'utf8'), key: createPrivateKey(readFileSync(join(dir, `${name}.key`), 'utf8')) };
}

test('googleKeySource: verifies against served certs, caches for max-age, refreshes once when a new kid appears', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'omni-certs-'));
  const a = makeCert(dir, 'a');
  const b = makeCert(dir, 'b');
  let served = { kidA: a.cert };
  let fetches = 0;
  let clock = 0;
  const fakeFetch = async () => { fetches++; return { ok: true, headers: new Map([['cache-control', 'public, max-age=100']]), json: async () => served }; };
  const src = googleKeySource({ fetchImpl: fakeFetch, now: () => clock });
  const v2 = (tok) => verifyIdToken(tok, { projectId: PROJECT, getKey: src });
  const good = claimsFor('maya@example.com');

  assert.equal((await v2(signJwt(good, { kid: 'kidA', key: a.key }))).email, 'maya@example.com');
  await v2(signJwt(good, { kid: 'kidA', key: a.key }));
  assert.equal(fetches, 1, 'second verify inside max-age must use the cache');

  served = { kidA: a.cert, kidB: b.cert };                // Google rotates a key in
  assert.equal((await v2(signJwt(good, { kid: 'kidB', key: b.key }))).email, 'maya@example.com');
  assert.equal(fetches, 2, 'an unknown kid triggers exactly one refresh');

  assert.equal(await reason(v2(signJwt(good, { kid: 'kidA', key: b.key }))), 'bad signature', 'kid A with key B');
  clock += 101_000;                                        // max-age passed
  await v2(signJwt(good, { kid: 'kidA', key: a.key }));
  assert.equal(fetches, 3, 'expired cache reloads');
});

test('googleKeySource: an unavailable key endpoint fails closed', async () => {
  const src = googleKeySource({ fetchImpl: async () => ({ ok: false, status: 503, headers: new Map(), json: async () => ({}) }) });
  await assert.rejects(src('k1'), AuthError);
});

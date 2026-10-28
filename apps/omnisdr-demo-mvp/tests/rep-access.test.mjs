// node --test tests/rep-access.test.mjs — the /rep Access verifier fails closed on every bad token.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessVerifier, AccessError } from '../src/rep/access.js';

const TEAM = 'omnisdr.cloudflareaccess.com', AUD = 'aud-rep-123', NOW = 1_800_000_000_000;
const ALG = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
const gen = () => crypto.subtle.generateKey({ ...ALG, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['sign', 'verify']);
const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

async function sign(priv, head, payload) {
  const h = enc(head), p = enc(payload);
  const sig = await crypto.subtle.sign(ALG, priv, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${Buffer.from(sig).toString('base64url')}`;
}
const t = Math.floor(NOW / 1000);
const good = { iss: `https://${TEAM}`, aud: [AUD], exp: t + 600, nbf: t - 10, email: ' Rep@Example.com ' };

const setup = async () => {
  const pair = await gen(), other = await gen();
  const verify = accessVerifier({ teamDomain: TEAM, aud: AUD, now: () => NOW, fetchKeys: async () => [{ kid: 'k1', key: pair.publicKey }] });
  return { pair, other, verify };
};
const rejects = async (p, status, re) => {
  await assert.rejects(p, (e) => e instanceof AccessError && e.status === status && re.test(e.message));
};

test('a valid token gives the lower-cased email', async () => {
  const { pair, verify } = await setup();
  assert.equal(await verify(await sign(pair.privateKey, { alg: 'RS256', kid: 'k1' }, good)), 'rep@example.com');
});

test('missing, empty and malformed tokens are 401', async () => {
  const { verify } = await setup();
  for (const tok of [null, undefined, '', 'a.b', 'a..c', 'x.y.z', '!!.!!.!!']) await rejects(verify(tok), 401, /malformed/);
});

test('a token signed by another key is 401', async () => {
  const { other, verify } = await setup();
  await rejects(verify(await sign(other.privateKey, { alg: 'RS256', kid: 'k1' }, good)), 401, /bad signature/);
});

test('a tampered payload is 401', async () => {
  const { pair, verify } = await setup();
  const tok = await sign(pair.privateKey, { alg: 'RS256', kid: 'k1' }, good);
  const [h, , s] = tok.split('.');
  await rejects(verify(`${h}.${enc({ ...good, email: 'boss@example.com' })}.${s}`), 401, /bad signature/);
});

test('alg none, HS256 and a missing kid are 401', async () => {
  const { pair, verify } = await setup();
  await rejects(verify(`${enc({ alg: 'none', kid: 'k1' })}.${enc(good)}.AAAA`), 401, /RS256/);
  await rejects(verify(await sign(pair.privateKey, { alg: 'HS256', kid: 'k1' }, good)), 401, /RS256/);
  await rejects(verify(await sign(pair.privateKey, { alg: 'RS256' }, good)), 401, /key id/);
});

test('unknown kid is 401', async () => {
  const { pair, verify } = await setup();
  await rejects(verify(await sign(pair.privateKey, { alg: 'RS256', kid: 'k9' }, good)), 401, /unknown key/);
});

test('wrong issuer, wrong audience, expired and not-yet-valid are 401', async () => {
  const { pair, verify } = await setup();
  const s = (p) => sign(pair.privateKey, { alg: 'RS256', kid: 'k1' }, { ...good, ...p });
  await rejects(verify(await s({ iss: 'https://evil.cloudflareaccess.com' })), 401, /issuer/);
  await rejects(verify(await s({ aud: ['some-other-app'] })), 401, /audience/);
  await rejects(verify(await s({ exp: t - 31 })), 401, /expired/);
  await rejects(verify(await s({ exp: undefined })), 401, /expired/);
  await rejects(verify(await s({ nbf: t + 31 })), 401, /not yet/);
});

test('a verified token with no usable email is 403', async () => {
  const { pair, verify } = await setup();
  for (const email of [undefined, '', 'not-an-email', 'a b@c.d']) {
    await rejects(verify(await sign(pair.privateKey, { alg: 'RS256', kid: 'k1' }, { ...good, email })), 403, /no email/);
  }
});

test('keys unreachable on first use is 401, not a pass', async () => {
  const verify = accessVerifier({ teamDomain: TEAM, aud: AUD, now: () => NOW, fetchKeys: async () => { throw new Error('down'); } });
  const pair = await gen();
  await rejects(verify(await sign(pair.privateKey, { alg: 'RS256', kid: 'k1' }, good)), 401, /keys unavailable/);
});

test('the verifier refuses to build without team or audience', () => {
  assert.throws(() => accessVerifier({ teamDomain: '', aud: AUD }));
  assert.throws(() => accessVerifier({ teamDomain: TEAM, aud: '' }));
});

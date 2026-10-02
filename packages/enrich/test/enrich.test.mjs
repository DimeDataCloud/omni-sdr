import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { isPublicAddress, safeFetch, FetchRefused } from '../src/fetch.mjs';
import { extractFacts } from '../src/extract.mjs';
import { enrichContact, websiteFor } from '../src/enrich.mjs';
import { checkDraft } from '../../gate/src/check.mjs';
import { freshDb, seedTenant, as, one, q } from '../../db/test/helpers.mjs';

// A transport stand-in: records each request and answers from a table keyed by host header + path.
function fakeTransport(pages) {
  const calls = [];
  const request = (opts, cb) => {
    calls.push(opts);
    const req = new EventEmitter();
    req.end = () => setImmediate(() => {
      const p = pages[`${opts.headers.host}${opts.path}`];
      if (!p) { req.emit('error', new Error('no such page')); return; }
      const res = Readable.from([Buffer.from(p.body ?? '')]);
      res.statusCode = p.status ?? 200;
      res.headers = { 'content-type': p.type ?? 'text/html; charset=utf-8', ...(p.location ? { location: p.location } : {}) };
      cb(res);
    });
    req.destroy = () => {};
    return req;
  };
  return { calls, transport: { http: { request }, https: { request } } };
}
const dns = (table) => async (host) => (table[host] ?? []).map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

test('public addresses only: private, loopback, link-local, metadata, CGNAT, ULA and mapped forms are refused', () => {
  for (const ip of ['10.128.0.2', '127.0.0.1', '169.254.169.254', '172.16.5.4', '192.168.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1',
    '255.255.255.255', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '::ffff:127.0.0.1', '2001:db8::1', '64:ff9b::a00:1', 'not-an-ip']) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  for (const ip of ['8.8.8.8', '104.16.1.1', '2606:4700::1111', '::ffff:8.8.8.8']) assert.equal(isPublicAddress(ip), true, ip);
});

test('safeFetch refuses unsafe URLs before any connection', async () => {
  const { calls, transport } = fakeTransport({});
  const lookup = dns({ 'internal.example.com': ['10.128.0.2'], 'meta.example.com': ['169.254.169.254'], 'mixed.example.com': ['8.8.8.8', '10.0.0.1'], 'loop6.example.com': ['::1'] });
  const cases = [
    ['file:///etc/passwd', /scheme/], ['ftp://a.example.com/', /scheme/], ['https://user:pw@a.example.com/', /credentials/],
    ['https://a.example.com:5432/', /port 5432/], ['http://10.128.0.2/', /literal IP/], ['http://[::1]/', /literal IP/],
    ['https://db.internal/', /host/], ['https://printer.local/', /host/], ['https://localhost/', /host/],
    ['https://internal.example.com/', /non-public/], ['https://meta.example.com/', /non-public/],
    ['https://mixed.example.com/', /non-public/], ['https://loop6.example.com/', /non-public/],
  ];
  for (const [url, why] of cases) {
    await assert.rejects(safeFetch(url, { lookup, transport }), (e) => e instanceof FetchRefused && why.test(e.message), url);
  }
  assert.equal(calls.length, 0, 'nothing was ever requested');
});

test('safeFetch pins the checked address, keeps SNI on the name, and re-checks every redirect', async () => {
  const { calls, transport } = fakeTransport({
    'brightline.com/': { status: 301, location: 'https://www.brightline.com/home' },
    'www.brightline.com/home': { body: '<title>Brightline</title>' },
    'evil.com/': { status: 302, location: 'http://internal.example.com/admin' },
  });
  const lookup = dns({ 'brightline.com': ['104.16.1.1'], 'www.brightline.com': ['104.16.1.2'], 'evil.com': ['8.8.8.8'], 'internal.example.com': ['10.128.0.2'] });
  const page = await safeFetch('https://brightline.com/', { lookup, transport });
  assert.equal(page.url, 'https://www.brightline.com/home');
  assert.deepEqual(calls.map((c) => [c.host, c.servername, c.headers.host]), [['104.16.1.1', 'brightline.com', 'brightline.com'], ['104.16.1.2', 'www.brightline.com', 'www.brightline.com']]);
  await assert.rejects(safeFetch('https://evil.com/', { lookup, transport }), /non-public/, 'a redirect into the VPC is refused');
  assert.equal(calls.filter((c) => c.host === '10.128.0.2').length, 0);
});

test('safeFetch refuses non-HTML and stops at the size cap', async () => {
  const { transport } = fakeTransport({ 'a.com/': { type: 'application/pdf', body: '%PDF' }, 'b.com/': { body: 'x'.repeat(5000) } });
  const lookup = dns({ 'a.com': ['8.8.8.8'], 'b.com': ['8.8.4.4'] });
  await assert.rejects(safeFetch('https://a.com/', { lookup, transport }), /content-type/);
  const big = await safeFetch('https://b.com/', { lookup, transport, maxBytes: 1000 });
  assert.equal(big.truncated, true);
  assert.ok(big.body.length <= 1000);
});

test('facts: vendor widgets, a book link without a widget, contact form, phone link and HTTPS', () => {
  const withWidget = extractFacts('<title>Brightline Family Dental</title><script src="https://booking.nexhealth.com/widget.js"></script><a href="tel:+16155550100">Call</a>', 'https://brightline.com/');
  assert.deepEqual([withWidget.booking.online, withWidget.booking.vendor, withWidget.contact.phone_link, withWidget.site.title], [true, 'NexHealth', true, 'Brightline Family Dental']);
  assert.equal(withWidget.booking.text, 'Your homepage offers online booking through NexHealth.');
  const linkOnly = extractFacts('<a href="/contact">Request an Appointment</a><form><input type="email"><textarea></textarea></form>', 'http://harbor.com/');
  assert.equal(linkOnly.booking.online, false);
  assert.equal(linkOnly.booking.text, 'Your homepage has a "Request an Appointment" link but no online booking widget.');
  assert.equal(linkOnly.contact.form, true);
  assert.equal(linkOnly.site.https, false);
  assert.equal(linkOnly.site.text, 'Your homepage loads without HTTPS (harbor.com).');
  const bare = extractFacts('<p>Welcome</p>', 'https://quiet.com/');
  assert.equal(bare.booking.text, 'Your homepage has no online booking.');
  assert.equal(bare.contact.text, 'Your homepage has no contact form.');
  assert.deepEqual(extractFacts('<p>Welcome</p>', 'https://quiet.com/'), bare, 'deterministic');
});

test('websiteFor: the business domain, never a free-mail provider', () => {
  assert.equal(websiteFor('lena@Brightline-Dental.com'), 'https://brightline-dental.com/');
  assert.equal(websiteFor('lena@gmail.com'), null);
  assert.equal(websiteFor('not an email'), null);
});

test('enrich → evidence → a first touch citing it passes the claims gate; another contact cannot borrow it', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha');
  const contact = (await one(db, `INSERT INTO contacts (org_id, workspace_id, name, email) VALUES ($1, $2, 'Lena', 'lena@brightline-dental.com') RETURNING id`, [t.org, t.ws])).id;
  const now = new Date('2026-10-07T15:00:00Z');
  const fetchPage = async (url) => ({ url, status: 200, body: '<title>Brightline</title><a href="/contact">Request an appointment</a>' });
  const r = await as(db, 'app_rw', { org: t.org, ws: [t.ws] }, () => enrichContact(db, { orgId: t.org, workspaceId: t.ws, contactId: contact, now, fetchPage }));
  assert.ok(r.evidenceId, JSON.stringify(r));
  const ev = await one(db, `SELECT contact_id, facts, expires_at, source_uri, type FROM evidence WHERE id = $1`, [r.evidenceId]);
  assert.deepEqual([ev.type, ev.source_uri], ['website', 'https://brightline-dental.com/']);
  const evidence = new Map([[r.evidenceId, ev]]);
  const sentence = ev.facts.booking.text;
  const draft = { subject: 'Booking at Brightline', step: 0, body: `Hi Lena,\n\n${sentence} Would a short walkthrough of online booking help?`,
    claims: [{ text: sentence, evidence_id: r.evidenceId, fact_key: 'booking.text' }] };
  const v = checkDraft(draft, { contactId: contact, evidence, now, competitors: [] });
  assert.equal(v.passed, true, JSON.stringify(v.findings));
  // Another contact can't cite it.
  assert.equal(checkDraft(draft, { contactId: t.contact, evidence, now, competitors: [] }).passed, false);
  // Free mail: nothing fetched.
  const gm = (await one(db, `INSERT INTO contacts (org_id, workspace_id, name, email) VALUES ($1, $2, 'G', 'g@gmail.com') RETURNING id`, [t.org, t.ws])).id;
  let fetched = 0;
  const skip = await as(db, 'app_rw', { org: t.org, ws: [t.ws] }, () => enrichContact(db, { orgId: t.org, workspaceId: t.ws, contactId: gm, now, fetchPage: async () => { fetched++; } }));
  assert.deepEqual([skip.skipped, fetched], ['no_business_domain', 0]);
  // Another tenant's contact is invisible under RLS.
  const b = await seedTenant(db, 'bravo');
  const cross = await as(db, 'app_rw', { org: b.org, ws: [b.ws] }, () => enrichContact(db, { orgId: b.org, workspaceId: b.ws, contactId: contact, now, fetchPage }));
  assert.equal(cross.skipped, 'contact_not_found');
  assert.equal((await q(db, `SELECT 1 FROM evidence WHERE contact_id = $1`, [contact])).length, 1);
});

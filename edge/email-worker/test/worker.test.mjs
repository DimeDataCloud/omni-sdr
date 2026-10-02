// The Email Worker under Node, against a fake API and then the real one (packages/api, PGlite).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import worker, { textOf } from '../src/index.mjs';

const SECRET = 'test-inbound-secret'; // packages/api/test/helpers.mjs INBOUND_SECRET
const TOKEN_TO = 'r+abcdefabcdefabcdef12@reply.omnisdr.com';
const mime = ({ to = TOKEN_TO, from = 'tom@maplegrove-dental.example', subject = 'Re: Hold times', body = 'Thursday works.', id = '<m1@maplegrove.example>', html } = {}) => [
  `From: Tom <${from}>`, `To: ${to}`, `Subject: ${subject}`, `Message-ID: ${id}`, 'MIME-Version: 1.0',
  ...(html ? ['Content-Type: text/html; charset=utf-8', '', html] : ['Content-Type: text/plain; charset=utf-8', '', body]),
].join('\r\n');
function message(raw, to = TOKEN_TO) {
  const m = { to, from: 'tom@maplegrove-dental.example', rawSize: raw.length, rejected: null, forwarded: null,
    raw: new Response(raw).body, setReject(r) { m.rejected = r; }, async forward(a) { m.forwarded = a; } };
  return m;
}
const env = { API_URL: 'https://api.test', INBOUND_SECRET: SECRET };
const NOW = Date.UTC(2026, 9, 2, 15, 0, 0);
function fakeApi(status = 200, outcome = 'recorded') {
  const calls = [];
  return { calls, fetchImpl: async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ outcome }), { status }); } };
}
const quiet = () => {};

test('a reply is posted, signed the way the API checks it, with only what the API needs', async () => {
  const api = fakeApi();
  await worker.email(message(mime()), env, {}, { fetchImpl: api.fetchImpl, now: () => NOW, log: quiet });
  assert.equal(api.calls.length, 1);
  const { url, init } = api.calls[0];
  assert.equal(url, 'https://api.test/internal/inbound');
  const ts = init.headers['x-omni-timestamp'];
  assert.equal(ts, String(NOW / 1000));
  assert.equal(init.headers['x-omni-signature'], `sha256=${createHmac('sha256', SECRET).update(`${ts}.`).update(init.body).digest('hex')}`);
  assert.deepEqual(JSON.parse(init.body), { to: TOKEN_TO, from: 'tom@maplegrove-dental.example', subject: 'Re: Hold times',
    body: 'Thursday works.\n', receivedAt: new Date(NOW).toISOString(), externalId: '<m1@maplegrove.example>' });
});

test('anything but r+<token>@reply.omnisdr.com is refused before reading it', async () => {
  for (const to of ['sales@reply.omnisdr.com', 'r+short@reply.omnisdr.com', 'r+abcdefabcdefabcdef12@evil.example', 'r+abcdefabcdefabcdef12@reply.omnisdr.com.evil.example']) {
    const api = fakeApi(); const m = message(mime({ to }), to);
    await worker.email(m, env, {}, { fetchImpl: api.fetchImpl, log: quiet });
    assert.equal(m.rejected, 'Unknown address', to);
    assert.equal(api.calls.length, 0, to);
  }
});

test('the API down: forwarded to the fallback mailbox if set, otherwise thrown so the sender retries; never dropped', async () => {
  const down = { fetchImpl: async () => { throw new Error('ECONNREFUSED'); } };
  const m1 = message(mime());
  await worker.email(m1, { ...env, FALLBACK_TO: 'replies-fallback@omnisdr.example' }, {}, { ...down, log: quiet });
  assert.equal(m1.forwarded, 'replies-fallback@omnisdr.example');
  await assert.rejects(worker.email(message(mime()), env, {}, { ...down, log: quiet }), /inbound not delivered: api_unreachable/);
  await assert.rejects(worker.email(message(mime()), env, {}, { fetchImpl: fakeApi(500).fetchImpl, log: quiet }), /api_500/);
  const logs = [];
  await assert.rejects(worker.email(message(mime({ body: 'please remove me' })), env, {}, { fetchImpl: fakeApi(503).fetchImpl, log: (e) => logs.push(e) }));
  assert.ok(!JSON.stringify(logs).includes('remove me') && !JSON.stringify(logs).includes('maplegrove'), 'logs carry no content or address');
});

test('a reply no send matches goes to the fallback mailbox, not the bin', async () => {
  const m = message(mime());
  await worker.email(m, { ...env, FALLBACK_TO: 'replies-fallback@omnisdr.example' }, {}, { fetchImpl: fakeApi(200, 'unmatched').fetchImpl, log: quiet });
  assert.equal(m.forwarded, 'replies-fallback@omnisdr.example');
  const m2 = message(mime());
  await worker.email(m2, { ...env, FALLBACK_TO: 'replies-fallback@omnisdr.example' }, {}, { fetchImpl: fakeApi(200, 'recorded').fetchImpl, log: quiet });
  assert.equal(m2.forwarded, null, 'a recorded reply is not also forwarded');
});

test('a long non-Latin reply is cut to fit the API body limit, keeping its top (bug bounty 2026-10-02)', async () => {
  const api = fakeApi();
  const body = 'Por favor, elimíname de su lista.\n' + '日本語のテキスト'.repeat(20000);
  await worker.email(message(mime({ body })), env, {}, { fetchImpl: api.fetchImpl, now: () => NOW, log: quiet });
  const sent = api.calls[0].init.body;
  assert.ok(Buffer.byteLength(sent) <= 240 * 1024, `payload is ${Buffer.byteLength(sent)} bytes`);
  assert.match(JSON.parse(sent).body, /^Por favor, elimíname de su lista\./);
});

test('HTML-only mail: text kept, the quoted thread marked as quoted so the API drops it', () => {
  const t = textOf({ html: '<div>Yes, Thursday at 2.</div><div><br></div><blockquote class="gmail_quote">Hi Tom,<br>Unsubscribe: https://app.omnisdr.com/u/tok</blockquote>' });
  assert.match(t, /^Yes, Thursday at 2\./);
  assert.ok(t.split('\n').filter((l) => /Unsubscribe/.test(l)).every((l) => l.startsWith('> ')));
});

// ─── end to end: our real outgoing email, a real reply quoting it, the worker, the real API ───────────────────
import PostalMime from 'postal-mime';
import { startApi } from '../../../packages/api/test/helpers.mjs';
import { sendDraft } from '../../../packages/sender/src/send.mjs';

const api = await startApi();
after(() => api.stop());

async function realSend(email) {
  const [d] = await api.q(`SELECT d.id, d.status FROM drafts d JOIN enrollments e ON e.id = d.enrollment_id JOIN contacts c ON c.id = e.contact_id
    WHERE c.email = $1 AND d.step = 0 AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.draft_id = d.id)`, [email]);
  if (d.status === 'review') assert.equal((await api.call('POST', `${api.W}/approvals/${d.id}/approve`)).status, 200);
  let raw = '';
  const out = await sendDraft(api.db, { orgId: api.demo.org, workspaceId: api.demo.workspaces[0], draftId: d.id, mailboxId: api.demo.mailbox,
    adapter: { async send(m) { raw = m.raw; return { providerMessageId: 'test' }; } },
    urls: { unsubscribeBase: 'https://app.test', replyDomain: 'reply.omnisdr.com' } });
  assert.equal(out.outcome, 'sent', out.reason);
  return raw;
}

test('end to end: a Gmail-style reply quoting our email lands as a meeting request, not an opt-out', async () => {
  const sent = await realSend('tom@maplegrove-dental.example');
  const replyTo = /^Reply-To: (.+)$/mi.exec(sent)[1].trim();
  const ours = (await PostalMime.parse(sent)).text; // what the prospect's mail client shows (we send base64)
  assert.match(ours, /Unsubscribe: https:\/\//, 'fixture: our email carries the footer');
  const body = `Could we set up a call Thursday afternoon?\r\n\r\nOn Tue, Sep 29, 2026 at 9:14 AM Maya Chen <maya@example.com> wrote:\r\n${ours.split(/\r?\n/).map((l) => `> ${l}`).join('\r\n')}`;
  // The worker talks to the real API over HTTP, as it will in production.
  const before = await api.q(`SELECT count(*)::int AS n FROM suppression WHERE value_hash = value_hash('tom@maplegrove-dental.example')`);
  await worker.email(message(mime({ to: replyTo, body, id: '<e2e-1@maplegrove.example>' }), replyTo),
    { API_URL: api.base, INBOUND_SECRET: SECRET }, {}, { log: quiet });
  const [row] = await api.q(`SELECT intent, sla_due_at, body FROM inbound_messages WHERE external_id = '<e2e-1@maplegrove.example>'`);
  assert.equal(row.intent, 'meeting_request');
  assert.ok(row.sla_due_at, 'the SLA clock started');
  assert.match(row.body, /> Unsubscribe:/, 'the stored body is the full reply');
  const afterRows = await api.q(`SELECT count(*)::int AS n FROM suppression WHERE value_hash = value_hash('tom@maplegrove-dental.example')`);
  assert.equal(afterRows[0].n, before[0].n, 'not suppressed');
  // The same message again (Email Routing retry) is a duplicate, not a second row.
  await worker.email(message(mime({ to: replyTo, body, id: '<e2e-1@maplegrove.example>' }), replyTo), { API_URL: api.base, INBOUND_SECRET: SECRET }, {}, { log: quiet });
  assert.equal((await api.q(`SELECT count(*)::int AS n FROM inbound_messages WHERE external_id = '<e2e-1@maplegrove.example>'`))[0].n, 1);
});

test('end to end: an opt-out above the quote, to a Reply-To a mail server upper-cased, still lands and suppresses', async () => {
  const [c] = await api.q(`SELECT c.email FROM drafts d JOIN enrollments e ON e.id = d.enrollment_id JOIN contacts c ON c.id = e.contact_id
    WHERE d.step = 0 AND d.gate_passed AND c.email <> 'tom@maplegrove-dental.example' AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.draft_id = d.id)
    ORDER BY c.email LIMIT 1`);
  assert.ok(c, 'fixture: the demo seed has a second sendable contact');
  const replyTo = /^Reply-To: (.+)$/mi.exec(await realSend(c.email))[1].trim();
  assert.match(replyTo, /^r\+[0-9a-f]{48}@/, 'reply tokens are lowercase hex');
  const shouted = replyTo.replace(/^r\+([^@]+)@/, (_, t) => `r+${t.toUpperCase()}@`);
  await worker.email(message(mime({ to: shouted, body: 'Please remove me from your list.\r\n\r\n> earlier text', id: '<e2e-2@x.example>' }), shouted),
    { API_URL: api.base, INBOUND_SECRET: SECRET }, {}, { log: quiet });
  const [row] = await api.q(`SELECT intent FROM inbound_messages WHERE external_id = '<e2e-2@x.example>'`);
  assert.equal(row?.intent, 'unsubscribe');
  const sup = await api.q(`SELECT count(*)::int AS n FROM suppression WHERE value_hash = value_hash($1)`, [c.email]);
  assert.equal(sup[0].n, 1);
});

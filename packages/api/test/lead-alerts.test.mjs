// 0030: the owner alert for a new lead. The write side is one transaction with the message; the relay emails only the workspace's
// admins, from memberships; it runs as alert_svc, which can reach nothing but three definers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApi } from './helpers.mjs';
import { relayAlerts, fakeAlertTransport } from '../src/services/alerts.mjs';
import { pglitePool, withClient } from '../src/pool.mjs';

async function withHook(config = {}) {
  const api = await startApi({ config });
  const r = await api.call('POST', `${api.W}/hooks`, { body: { name: 'Website form' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const post = (body) => api.call('POST', `/v1/hooks/${r.body.id}`, { as: null, token: r.body.token, body });
  const relay = (transport, opts = {}) => withClient(pglitePool(api.db), (c) => relayAlerts(c, { transport, consoleBase: 'https://app.test', ...opts }));
  return { api, post, relay };
}
const lead = (n = 1) => ({ message: `Can you quote a deck rebuild? ${n}`, email: `dana${n}@lead.example`, name: 'Dana Prospect', phone: '+16155550111', externalId: `site-${n}` });

test('alerts: a form lead writes one new_lead console item and one ids-only notify.lead row; a retry writes none', async () => {
  const { api, post } = await withHook();
  try {
    assert.equal((await post(lead())).status, 202);
    const n = await api.q(`SELECT kind, channel, inbound_message_id FROM notifications WHERE kind = 'new_lead'`);
    const o = await api.q(`SELECT topic, key, payload, published_at FROM outbox WHERE topic = 'notify.lead'`);
    assert.equal(n.length, 1);
    assert.deepEqual([n[0].kind, n[0].channel], ['new_lead', 'in_app']);
    assert.equal(o.length, 1);
    assert.equal(o[0].published_at, null);
    assert.deepEqual(Object.keys(o[0].payload).sort(), ['inbound_id', 'notification_id', 'workspace_id']);
    assert.equal(o[0].payload.inbound_id, n[0].inbound_message_id);
    const flat = JSON.stringify(o[0]);
    for (const secret of ['dana1@lead.example', 'Dana', '+1615', 'deck rebuild']) assert.ok(!flat.includes(secret), `outbox row must not carry ${secret}`);
    assert.equal((await post(lead())).status, 200, 'a retry is a duplicate');
    assert.equal((await api.q(`SELECT 1 FROM outbox WHERE topic = 'notify.lead'`)).length, 1);
    assert.equal((await api.q(`SELECT 1 FROM notifications WHERE kind = 'new_lead'`)).length, 1);
  } finally { await api.stop(); }
});

test('alerts: the console lists the new_lead item', async () => {
  const { api, post } = await withHook();
  try {
    await post(lead());
    const res = await api.call('GET', `${api.W}/notifications`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.items.filter((x) => x.kind === 'new_lead').map((x) => x.channel), ['in_app']);
  } finally { await api.stop(); }
});

test('alerts: an opt-out and a message past the daily cap are not leads and write no alert', async () => {
  const { api, post } = await withHook({ formDailyCap: 1 });
  try {
    assert.equal((await post(lead(1))).status, 202);
    assert.equal((await post({ message: 'please unsubscribe me, stop emailing', email: 'out@lead.example', externalId: 'site-out' })).status, 202, 'an opt-out past the cap is still recorded');
    assert.equal((await post(lead(2))).status, 429);
    assert.equal((await api.q(`SELECT 1 FROM outbox WHERE topic = 'notify.lead'`)).length, 1, 'only the first submission alerts');
    assert.equal((await api.q(`SELECT 1 FROM notifications WHERE kind = 'new_lead'`)).length, 1);
  } finally { await api.stop(); }
});

test('alerts: the relay emails the workspace admins only, once, and marks the row published', async () => {
  const { api, post, relay } = await withHook();
  try {
    // A second admin who covers only another workspace must not be told; operators, reviewers and viewers never are.
    const other = (await api.q(`INSERT INTO users (idp_uid, email) VALUES ('dev:elsewhere', 'elsewhere@example.com') RETURNING id`))[0].id;
    await api.q(`INSERT INTO memberships (org_id, user_id, role, workspace_ids) VALUES ($1, $2, 'admin', $3)`, [api.demo.org, other, [api.demo.workspaces[1]]]);
    await post(lead());
    const t = fakeAlertTransport();
    const first = await relay(t);
    assert.deepEqual(first, { claimed: 1, sent: 1, failed: 0, noRecipient: 0 });
    assert.equal(t.sent.length, 1);
    assert.deepEqual(t.sent[0].to, ['maya@example.com']);
    const text = JSON.stringify(t.sent[0]);
    for (const secret of ['dana1@lead.example', 'Dana', '+1615', 'deck rebuild']) assert.ok(!text.includes(secret), `the alert must not carry ${secret}`);
    assert.match(t.sent[0].text, /https:\/\/app\.test/);
    assert.notEqual((await api.q(`SELECT published_at FROM outbox WHERE topic = 'notify.lead'`))[0].published_at, null);
    assert.equal((await relay(t)).claimed, 0, 'a second pass finds nothing');
    assert.equal(t.sent.length, 1);
  } finally { await api.stop(); }
});

test('alerts: the recipient comes from memberships, never from what the lead typed', async () => {
  const { api, post, relay } = await withHook();
  try {
    await post({ message: 'hello', email: 'attacker@evil.example', name: 'attacker@evil.example', externalId: 'site-9' });
    const t = fakeAlertTransport();
    await relay(t);
    assert.deepEqual(t.sent.map((x) => x.to), [['maya@example.com']]);
  } finally { await api.stop(); }
});

test('alerts: a failed send leaves the row for the next pass; a later pass delivers it', async () => {
  const { api, post, relay } = await withHook();
  try {
    await post(lead());
    const down = fakeAlertTransport({ failFor: () => true });
    assert.deepEqual(await relay(down), { claimed: 1, sent: 0, failed: 1, noRecipient: 0 });
    assert.equal((await api.q(`SELECT published_at FROM outbox WHERE topic = 'notify.lead'`))[0].published_at, null);
    const up = fakeAlertTransport();
    assert.deepEqual(await relay(up), { claimed: 1, sent: 1, failed: 0, noRecipient: 0 });
    assert.equal(up.sent.length, 1);
  } finally { await api.stop(); }
});

test('alerts: one failing row does not stop the others in the same pass', async () => {
  const { api, post, relay } = await withHook();
  try {
    await post(lead(1));
    await post(lead(2));
    let calls = 0;
    const t = fakeAlertTransport({ failFor: () => ++calls === 1 });
    assert.deepEqual(await relay(t), { claimed: 2, sent: 1, failed: 1, noRecipient: 0 });
    assert.equal((await api.q(`SELECT 1 FROM outbox WHERE topic = 'notify.lead' AND published_at IS NULL`)).length, 1);
  } finally { await api.stop(); }
});

test('alerts: no transport wired means no claim: the rows wait', async () => {
  const { api, post, relay } = await withHook();
  try {
    await post(lead());
    assert.deepEqual(await relay(null), { claimed: 0, sent: 0, failed: 0, noRecipient: 0, skipped: 'no_transport' });
    assert.equal((await api.q(`SELECT 1 FROM outbox WHERE topic = 'notify.lead' AND published_at IS NULL`)).length, 1);
  } finally { await api.stop(); }
});

test('alerts: a workspace with no admin marks the row published (not retried forever) and keeps the console item', async () => {
  const { api, post, relay } = await withHook();
  try {
    await post(lead());
    await api.q(`UPDATE memberships SET role = 'operator' WHERE role = 'admin'`);
    const t = fakeAlertTransport();
    assert.deepEqual(await relay(t), { claimed: 1, sent: 0, failed: 0, noRecipient: 1 });
    assert.equal(t.sent.length, 0);
    assert.equal((await api.q(`SELECT 1 FROM notifications WHERE kind = 'new_lead'`)).length, 1);
  } finally { await api.stop(); }
});

test('alerts: alert_svc reaches nothing but the three definers: no message, no lead, no counter, no guard', async () => {
  const { api, post } = await withHook();
  try {
    await post(lead());
    const as = async (sql) => {
      await api.db.exec('SET ROLE alert_svc');
      try { await api.db.query(sql); return null; } catch (e) { return e.message; } finally { await api.db.exec('RESET ROLE'); }
    };
    for (const sql of [`SELECT * FROM messages`, `INSERT INTO messages (org_id) VALUES (gen_random_uuid())`, `SELECT * FROM contacts`,
      `SELECT * FROM inbound_messages`, `SELECT * FROM lead_events`, `SELECT * FROM send_counters`, `SELECT * FROM outbox`,
      `SELECT * FROM memberships`, `SELECT * FROM notifications`, `UPDATE outbox SET published_at = now()`]) {
      assert.match(await as(sql) ?? 'ALLOWED', /permission denied/, sql);
    }
    assert.match(await as(`SELECT send_guard(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid())`) ?? 'ALLOWED', /permission denied|does not exist|function/, 'no send_guard');
    assert.equal(await as(`SELECT * FROM alert_claim(1)`), null, 'the claim is allowed');
    // alert_publish only touches notify.lead rows.
    await api.q(`INSERT INTO outbox (org_id, topic, key, payload) VALUES ($1, 'inbound.received', 'k', '{}')`, [api.demo.org]);
    const ids = (await api.q(`SELECT id FROM outbox WHERE topic = 'inbound.received'`)).map((x) => x.id);
    await api.db.exec('SET ROLE alert_svc');
    try { await api.db.query(`SELECT alert_publish($1::bigint[])`, [ids]); } finally { await api.db.exec('RESET ROLE'); }
    assert.equal((await api.q(`SELECT 1 FROM outbox WHERE topic = 'inbound.received' AND published_at IS NOT NULL`)).length, 0);
  } finally { await api.stop(); }
});

test('alerts: the intake kick delivers without a cron, and a broken transport never fails or slows the intake', async () => {
  const good = fakeAlertTransport();
  {
    const { api, post } = await withHook({ alertTransport: good });
    try {
      assert.equal((await post(lead())).status, 202);
      for (let i = 0; i < 50 && !good.sent.length; i++) await new Promise((r) => setTimeout(r, 20));
      assert.equal(good.sent.length, 1);
      assert.deepEqual(good.sent[0].to, ['maya@example.com']);
    } finally { await api.stop(); }
  }
  const broken = { send: () => { throw new Error('provider down'); } };
  const { api, post } = await withHook({ alertTransport: broken });
  try {
    assert.equal((await post(lead())).status, 202, 'intake still succeeds');
    await new Promise((r) => setTimeout(r, 100));
    assert.equal((await api.q(`SELECT 1 FROM outbox WHERE topic = 'notify.lead' AND published_at IS NULL`)).length, 1, 'the row waits for the cron');
  } finally { await api.stop(); }
});

test('alerts: POST /internal/relay is signed and answers counts only', async () => {
  const transport = fakeAlertTransport();
  const { api, post } = await withHook({ alertTransport: transport });
  try {
    // Hold the kick back: make the first pass the signed call by posting, then checking whatever is left.
    await post(lead());
    for (let i = 0; i < 50 && !transport.sent.length; i++) await new Promise((r) => setTimeout(r, 20));
    const unsigned = await api.call('POST', '/internal/relay', { as: null, raw: '{}', headers: { 'content-type': 'application/json' } });
    assert.equal(unsigned.status, 401);
    const ok = await api.signedPost('/internal/relay', {});
    assert.equal(ok.status, 200, ok.text);
    assert.deepEqual(Object.keys(ok.body).sort(), ['claimed', 'failed', 'noRecipient', 'sent']);
  } finally { await api.stop(); }
});

test('alerts: a transport that never answers times out; intake is not held, and the row waits for the next pass', async () => {
  const hung = { send: () => new Promise(() => {}) };
  const { api, post, relay } = await withHook({ alertTransport: hung, alertSendTimeoutMs: 150 });
  try {
    const t0 = Date.now();
    assert.equal((await post(lead(1))).status, 202);
    assert.equal((await post(lead(2))).status, 202, 'the second post completes while the first kick is stuck');
    assert.ok(Date.now() - t0 < 3000, 'intake was not held by the hung send');
    // The direct pass times out the same way and releases its claim.
    assert.deepEqual(await relay(hung, { sendTimeoutMs: 100 }), { claimed: 2, sent: 0, failed: 2, noRecipient: 0 });
    assert.equal((await api.q(`SELECT 1 FROM outbox WHERE topic = 'notify.lead' AND published_at IS NULL`)).length, 2);
    const ok = fakeAlertTransport();
    assert.equal((await relay(ok)).sent, 2, 'a healthy provider then delivers both');
  } finally { await api.stop(); }
});

test('alerts: kicks are single flight: kicks fired while a pass runs start no further pass', async () => {
  const slow = { async send() { await new Promise((r) => setTimeout(r, 300)); } };
  const { api, post } = await withHook({ alertTransport: slow });
  try {
    await post(lead(1));
    await new Promise((r) => setTimeout(r, 400)); // the intake kick has finished its pass
    await post(lead(2));                          // starts a pass that now takes 300 ms in send
    let claims = 0;
    const query = api.db.query.bind(api.db);
    api.db.query = (sql, ...rest) => { if (/alert_claim/.test(String(sql))) claims++; return query(sql, ...rest); };
    api.kickAlerts(); api.kickAlerts(); api.kickAlerts();
    await new Promise((r) => setTimeout(r, 800));
    assert.ok(claims <= 1, `three kicks during one running pass started ${claims} more passes`);
  } finally { await api.stop(); }
});

test('alerts: each admin gets their own message and the row is done only when every send returned', async () => {
  const { api, post, relay } = await withHook();
  try {
    const second = (await api.q(`INSERT INTO users (idp_uid, email) VALUES ('dev:second', 'second@example.com') RETURNING id`))[0].id;
    await api.q(`INSERT INTO memberships (org_id, user_id, role, workspace_ids) VALUES ($1, $2, 'admin', NULL)`, [api.demo.org, second]);
    await post(lead());
    const t = fakeAlertTransport({ failFor: (m) => m.to[0] === 'second@example.com' });
    assert.deepEqual(await relay(t), { claimed: 1, sent: 0, failed: 1, noRecipient: 0 }, 'one failed recipient keeps the row');
    assert.deepEqual(t.sent.map((m) => m.to), [['maya@example.com']], 'each message names one address only');
    const all = fakeAlertTransport();
    assert.equal((await relay(all)).sent, 1);
    assert.deepEqual(all.sent.map((m) => m.to[0]).sort(), ['maya@example.com', 'second@example.com']);
  } finally { await api.stop(); }
});

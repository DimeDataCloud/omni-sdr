import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { freshDb, seedTenant, approvedDraft, as, one, q } from '../../db/test/helpers.mjs';
import { runSendPass, notDueReason, businessDaysBetween, inWindow } from '../src/loop.mjs';
import { seal, open, credentialKey, CredentialError } from '../src/credentials.mjs';

const URLS = { unsubscribeBase: 'https://api.example.test', replyDomain: 'reply.omnisdr.com' };
const KEY = randomBytes(32);
// Wednesday 2026-10-07 10:00 in Chicago (15:00 UTC): inside the window.
const WED_10 = new Date('2026-10-07T15:00:00Z');

function fakeAdapter(behaviour = () => ({ providerMessageId: `gm-${randomBytes(3).toString('hex')}` })) {
  const calls = [];
  return { calls, adapterFor: () => ({ name: 'fake', async send(m) { calls.push(m); return behaviour(m); } }) };
}
const pass = (db, a, over = {}) => runSendPass(db, { adapterFor: a.adapterFor, urls: URLS, now: () => WED_10, pause: async () => {}, ...over });

async function connect(db, t, mailbox = t.mailbox) {
  const secret = seal(KEY, { orgId: t.org, workspaceId: t.ws, mailboxId: mailbox }, `1//refresh-${randomBytes(8).toString('hex')}`);
  await as(db, 'app_rw', { org: t.org, ws: [t.ws] }, () => db.query(
    `INSERT INTO mailbox_credentials (org_id, workspace_id, mailbox_id, provider, secret, scopes, connected_by)
     VALUES ($1, $2, $3, 'gmail', $4, ARRAY['https://www.googleapis.com/auth/gmail.send'], $5)`, [t.org, t.ws, mailbox, secret, t.user]));
  return secret;
}
// A tenant whose seed message is gone, so its only approved draft is the one each test makes.
async function tenant(db, label, opts) {
  const t = await seedTenant(db, label, opts);
  await db.query(`DELETE FROM meetings WHERE org_id = $1`, [t.org]);
  // Anything that references a seeded reply goes first (0008's notifications), whichever migrations this tree has.
  if ((await db.query(`SELECT to_regclass('notifications') AS t`)).rows[0].t) await db.query(`DELETE FROM notifications WHERE org_id = $1`, [t.org]);
  await db.query(`DELETE FROM inbound_messages WHERE org_id = $1`, [t.org]);
  await db.query(`DELETE FROM messages WHERE org_id = $1`, [t.org]);
  await db.query(`DELETE FROM send_counters WHERE org_id = $1`, [t.org]);
  await db.query(`DELETE FROM mailbox_credentials WHERE org_id = $1`, [t.org]);   // each test connects what it needs
  await db.query(`UPDATE drafts SET status = 'discarded' WHERE org_id = $1`, [t.org]);
  await db.query(`UPDATE workspaces SET postal_address = '100 Example Street, Nashville, TN 37201', timezone = 'America/Chicago' WHERE id = $1`, [t.ws]);
  return t;
}
async function stepDraft(db, t, step) {
  const id = await approvedDraft(db, t);
  await db.query(`UPDATE drafts SET step = $2 WHERE id = $1`, [id, step]);
  return id;
}

test('rules: send window, business days and step waits', () => {
  assert.equal(inWindow(WED_10, 'America/Chicago'), true);
  assert.equal(inWindow(new Date('2026-10-07T12:00:00Z'), 'America/Chicago'), false, '07:00 Chicago is before the window');
  assert.equal(inWindow(new Date('2026-10-07T22:30:00Z'), 'America/Chicago'), false, '17:30 is after it');
  assert.equal(inWindow(new Date('2026-10-10T15:00:00Z'), 'America/Chicago'), false, 'Saturday');
  // Friday → next Wednesday: Mon, Tue, Wed = 3 business days.
  assert.equal(businessDaysBetween(new Date('2026-10-02T15:00:00Z'), WED_10, 'America/Chicago'), 3);
  assert.equal(businessDaysBetween(WED_10, WED_10, 'America/Chicago'), 0);
  const base = { enrollment_state: 'waiting', timezone: 'America/Chicago' };
  assert.equal(notDueReason({ ...base, step: 0 }, WED_10), null);
  assert.equal(notDueReason({ ...base, step: 0, enrollment_state: 'stopped' }, WED_10), 'enrollment_stopped');
  assert.equal(notDueReason({ ...base, step: 1, prev_sent_at: null }, WED_10), 'previous_step_not_sent');
  assert.equal(notDueReason({ ...base, step: 1, prev_sent_at: '2026-10-05T15:00:00Z' }, WED_10), 'waiting', 'Mon → Wed is 2 days, needs 3');
  assert.equal(notDueReason({ ...base, step: 1, prev_sent_at: '2026-10-02T15:00:00Z' }, WED_10), null);
  assert.equal(notDueReason({ ...base, step: 2, prev_sent_at: '2026-10-02T15:00:00Z' }, WED_10), 'waiting', 'step 2 waits 4');
});

test('loop: a due step-0 draft goes out once from the connected mailbox; a second pass sends nothing', async () => {
  const db = await freshDb();
  const t = await tenant(db, 'alpha');
  await connect(db, t);
  const draft = await approvedDraft(db, t);
  const a = fakeAdapter();
  const r = await pass(db, a);
  assert.equal(r.sent, 1, JSON.stringify(r));
  assert.equal(a.calls.length, 1);
  assert.equal((await one(db, `SELECT state, mailbox_id FROM messages WHERE draft_id = $1`, [draft])).state, 'sent');
  const again = await pass(db, a);
  assert.equal(again.sent, 0);
  assert.equal(a.calls.length, 1);
});

test('loop: nothing goes outside the window, without a connected mailbox, or from a revoked one', async () => {
  const db = await freshDb();
  const t = await tenant(db, 'alpha');
  await approvedDraft(db, t);
  const a = fakeAdapter();
  assert.equal((await pass(db, a)).skipped.no_mailbox_room, 1, 'no credentials row: not a sending mailbox');
  await connect(db, t);
  const night = await pass(db, a, { now: () => new Date('2026-10-07T04:00:00Z') });
  assert.deepEqual([night.sent, night.skipped.outside_window], [0, 1]);
  await as(db, 'app_rw', { org: t.org, ws: [t.ws] }, () => db.query(`UPDATE mailbox_credentials SET revoked_at = now() WHERE mailbox_id = $1`, [t.mailbox]));
  assert.equal((await pass(db, a)).skipped.no_mailbox_room, 1, 'revoked: no longer used');
  // A live credential whose grant lacks gmail.send is not a sending mailbox either (PR #36 audit P3).
  await as(db, 'app_rw', { org: t.org, ws: [t.ws] }, () => db.query(
    `UPDATE mailbox_credentials SET revoked_at = NULL, scopes = ARRAY['openid', 'email'] WHERE mailbox_id = $1`, [t.mailbox]));
  assert.equal((await pass(db, a)).skipped.no_mailbox_room, 1, 'no send scope: not used');
  assert.equal(a.calls.length, 0);
});

test('guard: a stopped enrollment refuses the send in the database, even when called directly', async () => {
  const db = await freshDb();
  const t = await tenant(db, 'alpha');
  const draft = await approvedDraft(db, t);
  await db.query(`UPDATE enrollments SET state = 'stopped', stop_reason = 'reply' WHERE id = $1`, [t.enrollment]);
  let msg = null;
  try {
    await as(db, 'sender_svc', { org: t.org, ws: [t.ws] }, () => db.query(
      `INSERT INTO messages (org_id, workspace_id, draft_id, mailbox_id, channel) VALUES ($1, $2, $3, $4, 'email')`, [t.org, t.ws, draft, t.mailbox]));
  } catch (e) { msg = e.message; }
  assert.match(msg ?? '', /send_guard: enrollment is stopped/);
  // The refusal rolled back the cap unit send_guard() took in the same statement.
  assert.equal((await q(db, `SELECT count FROM send_counters WHERE mailbox_id = $1`, [t.mailbox])).length, 0);
  // And the loop skips it before trying.
  await connect(db, t);
  const r = await pass(db, fakeAdapter());
  assert.deepEqual([r.sent, r.skipped.enrollment_stopped], [0, 1]);
});

test('loop: step 2 waits for step 1 to be sent and 3 business days to pass', async () => {
  const db = await freshDb();
  const t = await tenant(db, 'alpha', { cap: 10 });
  await connect(db, t);
  const first = await stepDraft(db, t, 0);
  const second = await stepDraft(db, t, 1);
  const a = fakeAdapter();
  const r1 = await pass(db, a);
  assert.deepEqual([r1.sent, r1.skipped.previous_step_not_sent], [1, 1], 'same pass: step 1 waits for step 0');
  // The database stamps sent_at with its own clock; pin it to the test's Wednesday morning.
  await db.query(`UPDATE messages SET sent_at = '2026-10-07T14:00:00Z' WHERE draft_id = $1`, [first]);
  assert.equal((await pass(db, a)).skipped.waiting, 1, 'sent today: still waiting');
  // Step 0 was sent the previous Friday.
  await db.query(`UPDATE messages SET sent_at = '2026-10-02T15:00:00Z' WHERE draft_id = $1`, [first]);
  const r3 = await pass(db, a);
  assert.equal(r3.sent, 1);
  assert.equal((await one(db, `SELECT state FROM messages WHERE draft_id = $1`, [second])).state, 'sent');
});

test('loop: the cap is respected across mailboxes, and an auth failure pauses that mailbox', async () => {
  const db = await freshDb();
  const t = await tenant(db, 'alpha', { cap: 1 });
  await connect(db, t);
  const other = (await one(db, `INSERT INTO mailboxes (org_id, workspace_id, provider, address, daily_cap) VALUES ($1, $2, 'gmail', 'second@alpha.test', 1) RETURNING id`, [t.org, t.ws])).id;
  await connect(db, t, other);
  // Three contacts, three step-0 drafts; two mailboxes with a cap of 1 each → 2 go, 1 waits.
  for (const n of [1, 2]) {
    const c = (await one(db, `INSERT INTO contacts (org_id, workspace_id, name, email, email_status) VALUES ($1, $2, 'C', $3, 'valid') RETURNING id`, [t.org, t.ws, `c${n}@alpha.test`])).id;
    const e = (await one(db, `INSERT INTO enrollments (org_id, workspace_id, campaign_id, contact_id) VALUES ($1, $2, $3, $4) RETURNING id`, [t.org, t.ws, t.campaign, c])).id;
    await approvedDraft(db, { ...t, enrollment: e });
  }
  await approvedDraft(db, t);
  const a = fakeAdapter();
  const r = await pass(db, a);
  assert.equal(r.sent, 2);
  assert.equal(r.skipped.no_mailbox_room, 1);
  assert.equal(new Set((await q(db, `SELECT mailbox_id FROM messages WHERE org_id = $1`, [t.org])).map((m) => m.mailbox_id)).size, 2, 'one from each');

  const db2 = await freshDb();
  const u = await tenant(db2, 'bravo');
  await connect(db2, u);
  await approvedDraft(db2, u);
  const { SendError } = await import('../src/adapters/gmail.mjs');
  const bad = fakeAdapter(() => { throw new SendError('auth', 'gmail 401'); });
  const r2 = await runSendPass(db2, { adapterFor: bad.adapterFor, urls: URLS, now: () => WED_10, pause: async () => {} });
  assert.deepEqual([r2.failed, r2.paused], [1, [u.mailbox]]);
  assert.equal((await one(db2, `SELECT paused_reason FROM mailboxes WHERE id = $1`, [u.mailbox])).paused_reason, 'reconnect');
});

test('loop: only lists workspaces with work, and stays inside each tenant', async () => {
  const db = await freshDb();
  const a = await tenant(db, 'alpha');
  const b = await tenant(db, 'bravo');
  await connect(db, a);
  await connect(db, b);
  await approvedDraft(db, a);
  const listed = await as(db, 'sender_svc', null, () => q(db, `SELECT org_id FROM sender_due_workspaces(10)`));
  assert.deepEqual(listed.map((x) => x.org_id), [a.org], 'bravo has nothing approved');
  const r = await pass(db, fakeAdapter());
  assert.deepEqual([r.workspaces, r.sent], [1, 1]);
});

test('credentials: seal and open round-trip; another mailbox, a tampered value or the wrong key never opens', () => {
  const scope = { orgId: 'o1', workspaceId: 'w1', mailboxId: 'm1' };
  const s = seal(KEY, scope, '1//refresh-token');
  assert.match(s, /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$/);
  assert.equal(open(KEY, scope, s), '1//refresh-token');
  assert.notEqual(seal(KEY, scope, '1//refresh-token'), s, 'a fresh IV each time');
  assert.throws(() => open(KEY, { ...scope, mailboxId: 'm2' }, s), CredentialError);
  assert.throws(() => open(randomBytes(32), scope, s), CredentialError);
  const [v, iv, body] = s.split('.');
  const flipped = Buffer.from(body, 'base64url'); flipped[0] ^= 1;
  assert.throws(() => open(KEY, scope, `${v}.${iv}.${flipped.toString('base64url')}`), CredentialError);
  assert.throws(() => credentialKey(randomBytes(16).toString('base64')), CredentialError);
  assert.equal(credentialKey(KEY.toString('base64')).equals(KEY), true);
});

test('credentials: the console can connect but never read a token back; another tenant sees nothing', async () => {
  const db = await freshDb();
  const a = await tenant(db, 'alpha');
  const b = await tenant(db, 'bravo');
  await connect(db, a);
  const ctxA = { org: a.org, ws: [a.ws] };
  let msg = null;
  try { await as(db, 'app_rw', ctxA, () => db.query(`SELECT secret FROM mailbox_credentials`)); } catch (e) { msg = e.message; }
  assert.match(msg ?? '', /permission denied/);
  const status = await as(db, 'app_rw', ctxA, () => q(db, `SELECT mailbox_id, revoked_at FROM mailbox_credentials`));
  assert.equal(status.length, 1);
  assert.equal((await as(db, 'sender_svc', { org: b.org, ws: [b.ws] }, () => q(db, `SELECT 1 FROM mailbox_credentials`))).length, 0);
  // A credential can't be written into another tenant's mailbox.
  let cross = null;
  try {
    await as(db, 'app_rw', ctxA, () => db.query(
      `INSERT INTO mailbox_credentials (org_id, workspace_id, mailbox_id, provider, secret, scopes) VALUES ($1, $2, $3, 'gmail', $4, ARRAY['x'])`,
      [a.org, a.ws, b.mailbox, seal(KEY, { orgId: a.org, workspaceId: a.ws, mailboxId: b.mailbox }, 'x')]));
  } catch (e) { cross = e.message; }
  assert.ok(cross, 'refused');
  assert.equal(open(KEY, { orgId: a.org, workspaceId: a.ws, mailboxId: a.mailbox },
    (await one(db, `SELECT secret FROM mailbox_credentials WHERE mailbox_id = $1`, [a.mailbox])).secret).startsWith('1//refresh-'), true);
});

test('loop: a token Google refuses pauses the mailbox before any claim, so the draft still sends after reconnecting', async () => {
  const db = await freshDb();
  const t = await tenant(db, 'alpha');
  await connect(db, t);
  const draft = await approvedDraft(db, t);
  const sent = [];
  const refused = { adapterFor: () => ({ name: 'gmail', async ready() { const e = new Error('invalid_grant'); e.kind = 'auth'; throw e; }, async send(m) { sent.push(m); return { providerMessageId: 'x' }; } }) };
  const r = await runSendPass(db, { adapterFor: refused.adapterFor, urls: URLS, now: () => WED_10, pause: async () => {} });
  assert.deepEqual([r.sent, r.paused, r.skipped.mailbox_needs_reconnect], [0, [t.mailbox], 1]);
  assert.equal((await q(db, `SELECT 1 FROM messages WHERE draft_id = $1`, [draft])).length, 0, 'nothing claimed');
  assert.equal((await q(db, `SELECT 1 FROM send_counters WHERE mailbox_id = $1`, [t.mailbox])).length, 0, 'no cap unit spent');
  // Reconnected: the same draft goes.
  await db.query(`UPDATE mailboxes SET paused_reason = NULL WHERE id = $1`, [t.mailbox]);
  const again = await pass(db, fakeAdapter());
  assert.equal(again.sent, 1);
});

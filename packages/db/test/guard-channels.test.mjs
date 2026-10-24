// send_guard must fail closed on a channel it has no checks for (SPEC S5, S13). Before 0019 an approved draft on
// 'sms' skipped the daily cap and one on 'linkedin_assist' skipped suppression, caps and holds' mailbox scope,
// and the guard let the message row in. Neither channel has a send path yet; the guard now says so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, seedTenant, as, refused, one, send, approvedDraft } from './helpers.mjs';

async function approvedOn(db, t, channel) {
  const ctx = { org: t.org, ws: [t.ws] };
  const id = await as(db, 'app_rw', ctx, async () => (await one(db,
    `INSERT INTO drafts (org_id, workspace_id, enrollment_id, channel, subject, body) VALUES ($1, $2, $3, $4, 'Quick note', 'Your booking page has no online scheduling.') RETURNING id`,
    [t.org, t.ws, t.enrollment, channel])).id);
  await as(db, 'gate_svc', ctx, () => db.query(
    `UPDATE drafts SET gate_passed = true, gate_body_sha = draft_sha(subject, body), gate_version = 'v1', gated_at = now(), status = 'review' WHERE id = $1`, [id]));
  await as(db, 'app_rw', ctx, () => db.query(`UPDATE drafts SET status = 'approved', approved_by = $2, approved_at = now() WHERE id = $1`, [id, t.user]));
  return id;
}

const sendOn = (db, t, draft, channel, mailbox) => as(db, 'sender_svc', { org: t.org, ws: [t.ws] }, () => db.query(
  `INSERT INTO messages (org_id, workspace_id, draft_id, mailbox_id, channel) VALUES ($1, $2, $3, $4, $5)`, [t.org, t.ws, draft, mailbox, channel]));

for (const channel of ['sms', 'linkedin_assist']) {
  test(`an approved, gated ${channel} draft cannot become a message: the guard has no checks for it`, async () => {
    const db = await freshDb();
    const t = await seedTenant(db, 'alpha');
    const d = await approvedOn(db, t, channel);
    for (const mailbox of [null, t.mailbox]) {
      const msg = await refused(sendOn(db, t, d, channel, mailbox));
      assert.match(msg ?? '', /send_guard: channel .* has no send path/, `${channel} mailbox=${mailbox}`);
    }
    assert.equal((await one(db, `SELECT count(*)::int AS n FROM messages WHERE draft_id = $1`, [d])).n, 0);
  });
}

test('email is unchanged: an approved draft still sends and the daily cap still holds', async () => {
  const db = await freshDb();
  const t = await seedTenant(db, 'alpha', { cap: 2 });
  const d1 = await approvedDraft(db, t);
  await send(db, t, d1);
  const d2 = await approvedDraft(db, t);
  assert.match((await refused(send(db, t, d2))) ?? '', /daily cap reached/);
});

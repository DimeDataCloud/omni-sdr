// B-3a: a draft on a channel this path does not send is refused and leaves no message row. The sender code refuses first
// (send.mjs), and the same draft inserted by hand is refused by send_guard (0019, packages/db/test/guard-channels.test.mjs),
// so no layer lets it through alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, seedTenant, as, one, refused } from '../../db/test/helpers.mjs';
import { sendDraft } from '../src/send.mjs';

const URLS = { unsubscribeBase: 'https://u.omnisdr.com', replyDomain: 'reply.omnisdr.com' };

for (const channel of ['sms', 'linkedin_assist']) {
  test(`sender: an approved ${channel} draft is refused, the provider is never called, no message row is inserted`, async () => {
    const db = await freshDb();
    const t = await seedTenant(db, 'alpha');
    await db.query(`UPDATE workspaces SET postal_address = '100 Example Street, Nashville, TN 37201' WHERE id = $1`, [t.ws]);
    const ctx = { org: t.org, ws: [t.ws] };
    const draft = await as(db, 'app_rw', ctx, async () => (await one(db,
      `INSERT INTO drafts (org_id, workspace_id, enrollment_id, channel, subject, body) VALUES ($1, $2, $3, $4, 'Quick note', 'Your booking page has no online scheduling.') RETURNING id`,
      [t.org, t.ws, t.enrollment, channel])).id);
    await as(db, 'gate_svc', ctx, () => db.query(
      `UPDATE drafts SET gate_passed = true, gate_body_sha = draft_sha(subject, body), gate_version = 'v1', gated_at = now(), status = 'review' WHERE id = $1`, [draft]));
    await as(db, 'app_rw', ctx, () => db.query(`UPDATE drafts SET status = 'approved', approved_by = $2, approved_at = now() WHERE id = $1`, [draft, t.user]));

    const calls = [];
    const adapter = { name: 'fake', async send(m) { calls.push(m); return { providerMessageId: 'x' }; } };
    const r = await sendDraft(db, { orgId: t.org, workspaceId: t.ws, draftId: draft, mailboxId: t.mailbox, adapter, urls: URLS });
    assert.equal(r.outcome, 'refused');
    assert.match(r.reason, new RegExp(`channel ${channel} is not sent by this path`));
    assert.equal(calls.length, 0);
    assert.equal((await one(db, `SELECT count(*)::int AS n FROM messages WHERE draft_id = $1`, [draft])).n, 0);
    // Second layer, same draft, the guard directly.
    const msg = await refused(as(db, 'sender_svc', ctx, () => db.query(
      `INSERT INTO messages (org_id, workspace_id, draft_id, mailbox_id, channel) VALUES ($1, $2, $3, $4, $5)`, [t.org, t.ws, draft, t.mailbox, channel])));
    assert.match(msg ?? '', /send_guard: channel .* has no send path/);
  });
}

// 0032 (3b): an approved lead draft can become a message, through the same send_guard, and every reader that reached a message
// through drafts and enrollments sees it. Each safety test pins ONE branch with the lead shape as the only path, so removing that
// branch fails it (the mutation proofs are run against these at gate time).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { freshDb, seedTenant, as, refused, one, q, approvedDraft, send } from './helpers.mjs';
import { can } from '../src/permissions.mjs';

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const ctxOf = (t) => ({ org: t.org, ws: [t.ws] });
const userCtx = (t, user = t.user) => ({ ...ctxOf(t), user });
const day = () => new Date().toISOString().slice(0, 10);

async function newLead(db, t, ext, { consent = 'express_form', channel = 'form', contact = t.contact } = {}) {
  return (await one(db, `INSERT INTO lead_events (org_id, workspace_id, contact_id, source, channel, external_id, consent_basis, received_at)
    VALUES ($1, $2, $3, 'web_form', $4, $5, $6, now()) RETURNING id`, [t.org, t.ws, contact, channel, ext, consent])).id;
}
let phones = 0;   // a distinct phone per contact: suppressing one person must not suppress the others through a shared number
async function newContact(db, t, tag, { emailStatus = 'unknown', email = `${tag}@lead.test` } = {}) {
  return (await one(db, `INSERT INTO contacts (org_id, workspace_id, name, email, email_status, phone) VALUES ($1, $2, 'Lee', $3, $4, $5) RETURNING id`,
    [t.org, t.ws, email, emailStatus, `+1615556${String(phones++).padStart(4, '0')}`])).id;
}
// A lead with a draft, gated and approved by the signed-in user. Returns ids; `approve: false` stops at review.
async function approvedLead(db, t, ext, { consent, channel, contact, approve = true, draftChannel = 'email', body = 'Thanks, Lee. When works for a call?' } = {}) {
  const c = contact ?? await newContact(db, t, ext);
  const lead = await newLead(db, t, ext, { consent, channel, contact: c });
  const id = (await as(db, 'app_rw', ctxOf(t), () => one(db,
    `INSERT INTO lead_drafts (org_id, workspace_id, contact_id, lead_event_id, channel, subject, body) VALUES ($1, $2, $3, $4, $5, 'Hello', $6) RETURNING id`,
    [t.org, t.ws, c, lead, draftChannel, body]))).id;
  await as(db, 'gate_svc', ctxOf(t), () => db.query(
    `UPDATE lead_drafts SET gate_passed = true, gate_body_sha = draft_sha(subject, body), gate_version = 'v1', gated_at = now(), status = 'review' WHERE id = $1`, [id]));
  if (approve) await as(db, 'app_rw', userCtx(t), () => db.query(
    `UPDATE lead_drafts SET status = 'approved', approved_by = $2, approved_at = now() WHERE id = $1`, [id, t.user]));
  return { id, lead, contact: c };
}
const sendLead = (db, t, id, { mailbox = t.mailbox, channel = 'email', org = t.org, ctx = ctxOf(t) } = {}) => as(db, 'sender_svc', ctx, () => db.query(
  `INSERT INTO messages (org_id, workspace_id, lead_draft_id, mailbox_id, channel) VALUES ($1, $2, $3, $4, $5)`, [org, t.ws, id, mailbox, channel]));
// Test-only: a past approval cannot be made through the API (approved_at is stamped by the trigger), so age one the way a superuser can,
// with the binding trigger off for that one statement.
const age = async (db, id, interval) => {
  await db.exec('ALTER TABLE lead_drafts DISABLE TRIGGER lead_drafts_approver_binding');
  await db.query(`UPDATE lead_drafts SET approved_at = now() - $2::interval WHERE id = $1`, [id, interval]);
  await db.exec('ALTER TABLE lead_drafts ENABLE TRIGGER lead_drafts_approver_binding');
};
const reason = (p) => refused(p).then((m) => m ?? 'SENT');
const fresh = async (label, opts) => { const db = await freshDb(); const t = await seedTenant(db, label, opts); await db.query('DELETE FROM org_send_counters'); await db.query('DELETE FROM send_counters'); return { db, t }; };

test('a message names exactly one draft, for every role, and the lead shape sends', async () => {
  const { db, t } = await fresh('a');
  const lead = await approvedLead(db, t, 'ls-1');
  const enr = await approvedDraft(db, t);
  const both = (role) => as(db, role, ctxOf(t), () => db.query(
    `INSERT INTO messages (org_id, workspace_id, draft_id, lead_draft_id, mailbox_id, channel) VALUES ($1, $2, $3, $4, $5, 'email')`, [t.org, t.ws, enr, lead.id, t.mailbox]));
  const neither = (role) => as(db, role, ctxOf(t), () => db.query(
    `INSERT INTO messages (org_id, workspace_id, mailbox_id, channel) VALUES ($1, $2, $3, 'email')`, [t.org, t.ws, t.mailbox]));
  for (const role of ['sender_svc', 'ops']) {
    assert.match(await refused(both(role)) ?? 'SENT', /messages_exactly_one_draft|names exactly one draft/, `both, ${role}`);
    assert.match(await refused(neither(role)) ?? 'SENT', /messages_exactly_one_draft|names exactly one draft/, `neither, ${role}`);
  }
  assert.match(await refused(db.query(`INSERT INTO messages (org_id, workspace_id, mailbox_id, channel) VALUES ($1, $2, $3, 'email')`, [t.org, t.ws, t.mailbox])) ?? 'SENT', /messages_exactly_one_draft|names exactly one draft/, 'neither, table owner');
  assert.equal(await refused(sendLead(db, t, lead.id)), null);
  const m = await one(db, `SELECT draft_id, lead_draft_id, state FROM messages WHERE lead_draft_id = $1`, [lead.id]);
  assert.deepEqual([m.draft_id, m.lead_draft_id, m.state], [null, lead.id, 'claimed']);
  assert.equal(await refused(send(db, t, enr)), null, 'the enrollment shape still sends');
});

test('a lead draft is claimed once, structurally', async () => {
  const { db, t } = await fresh('a');
  const lead = await approvedLead(db, t, 'ls-2');
  assert.equal(await refused(sendLead(db, t, lead.id)), null);
  assert.match(await reason(sendLead(db, t, lead.id)), /messages_lead_draft_id_key/);
});

test('a lead draft names the lead\'s own contact (composite FK, not only the guard)', async () => {
  const { db, t } = await fresh('a');
  const other = await newContact(db, t, 'other');
  const lead = await newLead(db, t, 'ls-3');
  assert.match(await reason(db.query(`INSERT INTO lead_drafts (org_id, workspace_id, contact_id, lead_event_id, channel, body) VALUES ($1, $2, $3, $4, 'email', 'x')`,
    [t.org, t.ws, other, lead])), /lead_drafts_lead_contact_fk/);
});

// ─── the approval is the signed-in approver's ────────────────────────────────────────────────────────────────────
test('an approval needs the signed-in approver: no user context, another user, or a member who cannot approve all refuse', async () => {
  const { db, t } = await fresh('a');
  const { id } = await approvedLead(db, t, 'ls-4', { approve: false });
  const approveAs = (ctx, by = t.user, role = 'app_rw') => as(db, role, ctx, () => db.query(
    `UPDATE lead_drafts SET status = 'approved', approved_by = $2, approved_at = now() WHERE id = $1`, [id, by]));
  // No user context (a service path, or the table owner): refused, with no exception for a missing context.
  assert.match(await reason(approveAs(ctxOf(t))), /signed-in approver/);
  assert.match(await reason(db.query(`UPDATE lead_drafts SET status = 'approved', approved_by = $2, approved_at = now() WHERE id = $1`, [id, t.user])), /signed-in approver/);
  // Naming someone else.
  const other = (await one(db, `INSERT INTO users (idp_uid, email) VALUES ('uid-o', 'o@example.test') RETURNING id`)).id;
  await db.query(`INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'admin')`, [t.org, other]);
  assert.match(await reason(approveAs(userCtx(t), other)), /signed-in approver/);
  // A closer, and a client viewer while client approvals are off, may not approve.
  const closer = (await one(db, `INSERT INTO users (idp_uid, email) VALUES ('uid-c', 'c@example.test') RETURNING id`)).id;
  await db.query(`INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'closer')`, [t.org, closer]);
  // A closer cannot even see a lead draft (closer_scope), so the UPDATE matches no row: it must not have approved anything.
  await approveAs(userCtx(t, closer), closer).catch(() => {});
  assert.equal((await one(db, `SELECT status FROM lead_drafts WHERE id = $1`, [id])).status, 'review', 'a closer approved nothing');
  const viewer = (await one(db, `INSERT INTO users (idp_uid, email) VALUES ('uid-v', 'v@example.test') RETURNING id`)).id;
  await db.query(`INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'client_viewer')`, [t.org, viewer]);
  assert.match(await reason(approveAs(userCtx(t, viewer), viewer)), /cannot approve here/);
  await db.query(`UPDATE workspaces SET client_approvals_enabled = true WHERE id = $1`, [t.ws]);
  assert.equal(await refused(approveAs(userCtx(t, viewer), viewer)), null, 'a client viewer may approve once the workspace allows it');
});

test('lead_approver_ok mirrors permissions.mjs can(approve) over role x client approvals x membership scope', async () => {
  const { db, t } = await fresh('a');
  const ws2 = (await one(db, `INSERT INTO workspaces (org_id, name) VALUES ($1, 'second') RETURNING id`, [t.org])).id;
  let i = 0;
  for (const role of ['admin', 'operator', 'reviewer', 'client_viewer', 'closer']) {
    for (const enabled of [false, true]) {
      await db.query(`UPDATE workspaces SET client_approvals_enabled = $2 WHERE id = $1`, [t.ws, enabled]);
      for (const scope of ['all', 'this', 'other']) {
        const u = (await one(db, `INSERT INTO users (idp_uid, email) VALUES ($1, $2) RETURNING id`, [`uid-m${i}`, `m${i++}@example.test`])).id;
        await db.query(`INSERT INTO memberships (org_id, user_id, role, workspace_ids) VALUES ($1, $2, $3, $4)`,
          [t.org, u, role, scope === 'all' ? null : scope === 'this' ? [t.ws] : [ws2]]);
        const got = (await one(db, `SELECT lead_approver_ok($1, $2, $3) AS ok`, [t.org, t.ws, u])).ok;
        const want = can({ role, clientApprovalsEnabled: enabled }, 'approve') && scope !== 'other';
        assert.equal(got, want, `${role} approvals=${enabled} scope=${scope}`);
      }
    }
  }
  assert.equal((await one(db, `SELECT lead_approver_ok($1, $2, NULL) AS ok`, [t.org, t.ws])).ok, false);
  assert.equal((await one(db, `SELECT lead_approver_ok(gen_random_uuid(), $1, $2) AS ok`, [t.ws, t.user])).ok, false, 'another org');
});

// ─── consent: the guard's function against lead_touch_blocker ────────────────────────────────────────────────────
test('lead_send_blocker agrees with lead_touch_blocker over consent x lead channel x send channel x suppression', async () => {
  const { db, t } = await fresh('a');
  let i = 0;
  for (const consent of ['express_form', 'inquiry_reply', 'none']) {
    for (const leadChannel of ['form', 'email', 'sms', 'voice']) {
      for (const sendChannel of ['email', 'sms', 'voice']) {
        for (const suppressed of [false, true]) {
          const ext = `par-${i++}`;
          const lead = await approvedLead(db, t, ext, { consent, channel: leadChannel, approve: false });
          if (suppressed) await as(db, 'inbox_svc', ctxOf(t), () => db.query(`SELECT suppress_person($1, 'manual')`, [lead.contact]));
          const guard = (await one(db, `SELECT lead_send_blocker($1, $2) AS r`, [lead.id, sendChannel])).r;
          const blocker = await as(db, 'app_rw', ctxOf(t), async () => (await one(db, `SELECT lead_touch_blocker($1, $2) AS r`, [lead.lead, sendChannel])).r);
          assert.equal(guard, blocker, `${consent} lead=${leadChannel} send=${sendChannel} suppressed=${suppressed}`);
        }
      }
    }
  }
  assert.equal((await one(db, `SELECT lead_send_blocker(gen_random_uuid(), 'email') AS r`)).r, 'not_found');
});

// ─── the guard's lead branch, one refusal per test path ──────────────────────────────────────────────────────────
test('the guard refuses a lead draft that is not approved, was edited after approval, or whose approval is too old', async () => {
  const { db, t } = await fresh('a');
  const review = await approvedLead(db, t, 'g-1', { approve: false });
  assert.match(await reason(sendLead(db, t, review.id)), /not approved with a current gate pass/);
  const edited = await approvedLead(db, t, 'g-2');
  await as(db, 'app_rw', ctxOf(t), () => db.query(`UPDATE lead_drafts SET body = 'A different body.' WHERE id = $1`, [edited.id]));
  assert.match(await reason(sendLead(db, t, edited.id)), /not approved with a current gate pass/);
  const old = await approvedLead(db, t, 'g-3');
  await age(db, old.id, '8 days');
  assert.match(await reason(sendLead(db, t, old.id)), /older than 7 days/);
  const fine = await approvedLead(db, t, 'g-4');
  await age(db, fine.id, '6 days');
  assert.equal(await refused(sendLead(db, t, fine.id)), null);
  // The boundary itself (V-45 P3-3): a minute inside 7 days sends, a minute outside does not.
  const inside = await approvedLead(db, t, 'g-5');
  await age(db, inside.id, '6 days 23 hours 59 minutes');
  assert.equal(await refused(sendLead(db, t, inside.id)), null, 'just inside 7 days');
  const outside = await approvedLead(db, t, 'g-6');
  await age(db, outside.id, '7 days 1 minute');
  assert.match(await reason(sendLead(db, t, outside.id)), /older than 7 days/, 'just outside 7 days');
});

test('the guard re-checks the approver NOW: a removed, demoted or workspace-excluded approver does not send', async () => {
  const { db, t } = await fresh('a');
  const mk = async (ext) => approvedLead(db, t, ext);
  const removed = await mk('a-1');
  await db.query(`UPDATE memberships SET role = 'closer' WHERE org_id = $1 AND user_id = $2`, [t.org, t.user]);
  assert.match(await reason(sendLead(db, t, removed.id)), /approver may no longer approve/, 'demoted to closer');
  await db.query(`UPDATE memberships SET role = 'admin', workspace_ids = ARRAY[gen_random_uuid()] WHERE org_id = $1 AND user_id = $2`, [t.org, t.user]);
  assert.match(await reason(sendLead(db, t, removed.id)), /approver may no longer approve/, 'membership no longer covers the workspace');
  await db.query(`DELETE FROM memberships WHERE org_id = $1 AND user_id = $2`, [t.org, t.user]);
  assert.match(await reason(sendLead(db, t, removed.id)), /approver may no longer approve/, 'membership removed');
  await db.query(`INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'admin')`, [t.org, t.user]);
  assert.equal(await refused(sendLead(db, t, removed.id)), null, 'control: restored membership sends');
});

test('the guard refuses a lead without consent, a suppressed person, and an sms the lead did not start', async () => {
  const { db, t } = await fresh('a');
  const none = await approvedLead(db, t, 'c-1', { consent: 'none' });
  assert.match(await reason(sendLead(db, t, none.id)), /lead cannot be contacted \(no_consent\)/);
  const supp = await approvedLead(db, t, 'c-2');
  await as(db, 'inbox_svc', ctxOf(t), () => db.query(`SELECT suppress_person($1, 'manual')`, [supp.contact]));
  assert.match(await reason(sendLead(db, t, supp.id)), /lead cannot be contacted \(suppressed\)/);
  const smsFromForm = await approvedLead(db, t, 'c-3', { draftChannel: 'sms' });
  assert.match(await reason(sendLead(db, t, smsFromForm.id, { channel: 'sms' })), /lead cannot be contacted \(no_consent\)/);
  const smsFromSms = await approvedLead(db, t, 'c-4', { draftChannel: 'sms', channel: 'sms' });
  assert.match(await reason(sendLead(db, t, smsFromSms.id, { channel: 'sms' })), /channel sms has no send path/, 'consent passes; the channel has no path until A2P');
});

test('the guard takes email_status unknown and valid for a lead and refuses invalid and risky; no address refuses', async () => {
  const { db, t } = await fresh('a');
  for (const [status, ok] of [['unknown', true], ['valid', true], ['invalid', false], ['risky', false]]) {
    const c = await newContact(db, t, `es-${status}`, { emailStatus: status });
    const l = await approvedLead(db, t, `es-${status}`, { contact: c });
    const r = await reason(sendLead(db, t, l.id));
    if (ok) assert.equal(r, 'SENT', status); else assert.match(r, /contact email not verified/, status);
  }
  // An anonymized contact has no address: erasure leaves the lead event, and nothing can be sent to it.
  const anon = await newContact(db, t, 'anon');
  const l = await approvedLead(db, t, 'es-anon', { contact: anon });
  await db.query(`UPDATE contacts SET email = NULL WHERE id = $1`, [anon]);
  assert.match(await reason(sendLead(db, t, l.id)), /contact email not verified/);
});

test('holds, a paused mailbox, the org cap, the mailbox cap and a foreign tenant apply to a lead message as to any other', async () => {
  const { db, t } = await fresh('a', { cap: 2 });
  const hold = (type, id) => db.query(`INSERT INTO holds (org_id, scope_type, scope_id, reason, set_by) VALUES ($1, $2, $3, 'test', 'test')`, [t.org, type, id]);
  for (const [type, id] of [['org', t.org], ['workspace', t.ws], ['mailbox', t.mailbox]]) {
    const l = await approvedLead(db, t, `h-${type}`);
    await hold(type, id);
    assert.match(await reason(sendLead(db, t, l.id)), /on hold/, type);
    await db.query(`DELETE FROM holds WHERE scope_type = $1 AND scope_id = $2`, [type, id]);
  }
  const paused = await approvedLead(db, t, 'h-paused');
  await db.query(`UPDATE mailboxes SET paused_reason = 'bounces' WHERE id = $1`, [t.mailbox]);
  assert.match(await reason(sendLead(db, t, paused.id)), /mailbox paused/);
  await db.query(`UPDATE mailboxes SET paused_reason = NULL WHERE id = $1`, [t.mailbox]);
  // The org cap is shared with campaign sends: one 200.
  await db.query(`INSERT INTO org_send_counters (org_id, day, count) VALUES ($1, $2, 200)`, [t.org, day()]);
  assert.match(await reason(sendLead(db, t, paused.id)), /organization daily cap reached/);
  await db.query(`UPDATE org_send_counters SET count = 0 WHERE org_id = $1`, [t.org]);
  assert.equal(await refused(sendLead(db, t, paused.id)), null);
  assert.equal((await one(db, `SELECT count FROM org_send_counters WHERE org_id = $1 AND day = $2`, [t.org, day()])).count, 1, 'the lead send took one unit of the shared org counter');
  const second = await approvedLead(db, t, 'h-cap2');
  const third = await approvedLead(db, t, 'h-cap3');
  assert.equal(await refused(sendLead(db, t, second.id)), null);
  assert.match(await reason(sendLead(db, t, third.id)), /mailbox daily cap reached/, 'mailbox cap 2 is shared too');
  // A message claiming another tenant's org is refused before anything else.
  const b = await seedTenant(db, 'b');
  const l = await approvedLead(db, t, 'h-tenant');
  assert.match(await reason(as(db, 'ops', ctxOf(t), () => db.query(
    `INSERT INTO messages (org_id, workspace_id, lead_draft_id, mailbox_id, channel) VALUES ($1, $2, $3, $4, 'email')`, [b.org, b.ws, l.id, b.mailbox]))), /another tenant/);
});

test('the guard refuses a channel mismatch on a lead message', async () => {
  const { db, t } = await fresh('a');
  const l = await approvedLead(db, t, 'ch-1');
  assert.match(await reason(sendLead(db, t, l.id, { channel: 'sms' })), /channel mismatch/);
});

test('the enrollment guard does not block a lead message, and still blocks a stopped enrollment', async () => {
  const { db, t } = await fresh('a');
  const enr = await approvedDraft(db, t);
  await db.query(`UPDATE enrollments SET state = 'stopped', stop_reason = 'unsubscribe' WHERE id = $1`, [t.enrollment]);
  assert.match(await reason(send(db, t, enr)), /enrollment is stopped/);
  // The contact on the stopped enrollment is not the lead's contact, so the lead message is unaffected.
  const l = await approvedLead(db, t, 'en-1');
  assert.equal(await refused(sendLead(db, t, l.id)), null);
});

// ─── the readers ─────────────────────────────────────────────────────────────────────────────────────────────────
async function sentLead(db, t, ext, opts) {
  const l = await approvedLead(db, t, ext, opts);
  assert.equal(await refused(sendLead(db, t, l.id)), null);
  const m = (await one(db, `SELECT id FROM messages WHERE lead_draft_id = $1`, [l.id])).id;
  const pmid = `prov-${ext}`;
  await as(db, 'sender_svc', ctxOf(t), () => db.query(`UPDATE messages SET state = 'sent', sent_at = now(), provider_message_id = $2 WHERE id = $1`, [m, pmid]));
  return { ...l, message: m, pmid };
}

test('message_handoff_ok places a lead message and answers false once its contact opts out', async () => {
  const { db, t } = await fresh('a');
  const l = await sentLead(db, t, 'r-1');
  const ok = () => as(db, 'sender_svc', ctxOf(t), async () => (await one(db, `SELECT message_handoff_ok($1) AS ok`, [l.message])).ok);
  assert.equal(await ok(), true);
  await as(db, 'inbox_svc', ctxOf(t), () => db.query(`SELECT suppress_person($1, 'manual')`, [l.contact]));
  assert.equal(await ok(), false);
});

test('a complaint or a terminal bounce on a lead message suppresses its contact, by provider id and by recipient', async () => {
  const { db, t } = await fresh('a');
  const rec = (pmid, type, terminal, recipient = null) => as(db, 'inbox_svc', {}, async () => (await one(db, `SELECT record_mail_event($1, $2, $3, $4) AS r`, [pmid, type, terminal, recipient])).r);
  const l1 = await sentLead(db, t, 'r-2');
  assert.equal(await rec(l1.pmid, 'complained', false), 'recorded');
  assert.equal((await one(db, `SELECT _person_suppressed($1, 'email') AS s`, [l1.contact])).s, true, 'complaint suppresses the person');
  const l2 = await sentLead(db, t, 'r-3');
  assert.equal(await rec('no-such-id', 'bounced', true, `r-3@lead.test`), 'recorded', 'the recipient fallback finds a lead message');
  const sup = await q(db, `SELECT 1 FROM suppression WHERE value_hash = value_hash($1) AND reason = 'bounce'`, ['r-3@lead.test']);
  assert.equal(sup.length, 1, 'terminal bounce suppresses the address');
  assert.equal((await one(db, `SELECT acted FROM mail_events WHERE message_id = $1`, [l2.message])).acted, 'address');
});

test('a reply to a lead message resolves to the lead\'s contact', async () => {
  const { db, t } = await fresh('a');
  const l = await sentLead(db, t, 'r-4');
  const hash = sha('reply-token-r4');
  await db.query(`UPDATE messages SET reply_token_hash = $2 WHERE id = $1`, [l.message, hash]);
  const r = await as(db, 'inbox_svc', {}, () => q(db, `SELECT * FROM inbox_resolve_reply($1)`, [hash]));
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].org_id, r[0].workspace_id, r[0].message_id, r[0].contact_id], [t.org, t.ws, l.message, l.contact]);
});

test('a workspace whose only approved work is a lead draft is due, and stops being due once sent', async () => {
  const { db, t } = await fresh('a');
  await db.query(`UPDATE drafts SET status = 'discarded' WHERE org_id = $1 AND status = 'approved'`, [t.org]).catch(() => {});
  const due = () => as(db, 'sender_svc', {}, async () => (await q(db, `SELECT * FROM sender_due_workspaces(100)`)).find((r) => r.workspace_id === t.ws)?.approved ?? 0);
  const before = Number(await due());
  const l = await approvedLead(db, t, 'r-5');
  assert.equal(Number(await due()), before + 1);
  assert.equal(await refused(sendLead(db, t, l.id)), null);
  assert.equal(Number(await due()), before);
  const stale = await approvedLead(db, t, 'r-5b');
  await age(db, stale.id, '8 days');
  assert.equal(Number(await due()), before, 'an expired approval does not keep the workspace due');
});

test('record_first_touch accepts a sent lead message, once, and refuses one that has not been sent', async () => {
  const { db, t } = await fresh('a');
  const l = await approvedLead(db, t, 'r-6');
  assert.equal(await refused(sendLead(db, t, l.id)), null);
  const m = (await one(db, `SELECT id FROM messages WHERE lead_draft_id = $1`, [l.id])).id;
  const touch = () => as(db, 'sender_svc', ctxOf(t), async () => (await one(db, `SELECT record_first_touch($1, 'email', 'agent', $2) AS r`, [l.lead, m])).r);
  assert.equal(await touch(), 'message_not_sent');
  await as(db, 'sender_svc', ctxOf(t), () => db.query(`UPDATE messages SET state = 'sent', sent_at = now() WHERE id = $1`, [m]));
  assert.equal(await touch(), 'recorded');
  assert.equal(await touch(), 'already_touched');
  const r = await one(db, `SELECT first_touch_message_id AS m, first_touch_by AS by FROM lead_events WHERE id = $1`, [l.lead]);
  assert.deepEqual([r.m, r.by], [m, 'agent']);
});

test('the unsubscribe link on a lead email works end to end: the token suppresses the contact and the next send is refused', async () => {
  const { db, t } = await fresh('a');
  const l = await sentLead(db, t, 'r-7');
  const token = 'tok-r7';
  await as(db, 'sender_svc', ctxOf(t), () => db.query(
    `INSERT INTO unsubscribe_tokens (token_hash, org_id, workspace_id, contact_id, channel) VALUES ($1, $2, $3, $4, 'email')`, [sha(token), t.org, t.ws, l.contact]));
  assert.equal((await one(db, `SELECT unsubscribe($1) AS ok`, [token])).ok, true);
  const next = await approvedLead(db, t, 'r-7b', { contact: l.contact });
  assert.match(await reason(sendLead(db, t, next.id)), /contact suppressed|lead cannot be contacted \(suppressed\)/);
});

// ─── V-45 P2-1: the time of an approval is the database's ───────────────────────────────────────────────────────────
test('approved_at is stamped by the approval and cannot be supplied or rewritten (the 7-day cap is not the caller\'s to move)', async () => {
  const { db, t } = await fresh('a');
  const approveWith = (id, at) => as(db, 'app_rw', userCtx(t), () => db.query(
    `UPDATE lead_drafts SET status = 'approved', approved_by = $2, approved_at = ${at} WHERE id = $1`, [id, t.user]));
  for (const [label, at] of [['100 years ahead', "now() + interval '100 years'"], ['100 days ago', "now() - interval '100 days'"], ['NULL', 'NULL']]) {
    const { id } = await approvedLead(db, t, `fa-${label}`, { approve: false });
    await approveWith(id, at);
    const r = await one(db, `SELECT status, abs(extract(epoch FROM (approved_at - now()))) AS drift FROM lead_drafts WHERE id = $1`, [id]);
    assert.equal(r.status, 'approved', label);
    assert.ok(Number(r.drift) < 5, `${label}: approved_at is the database's now(), not the supplied value`);
    assert.equal(await refused(sendLead(db, t, id)), null, `${label}: and the draft sends, because the approval is fresh`);
  }
  // Rewriting it on an approved row, with no approval change, is refused for the approver, the gate role and the table owner.
  const { id } = await approvedLead(db, t, 'fa-rewrite');
  for (const [role, ctx] of [['app_rw', userCtx(t)], ['gate_svc', ctxOf(t)]]) {
    assert.match(await reason(as(db, role, ctx, () => db.query(`UPDATE lead_drafts SET approved_at = now() + interval '100 years' WHERE id = $1`, [id]))),
      /approved_at is set by the approval|permission denied/, role);
  }
  assert.match(await reason(db.query(`UPDATE lead_drafts SET approved_at = now() + interval '100 years' WHERE id = $1`, [id])), /approved_at is set by the approval/, 'table owner');
  // An old approval cannot be refreshed without a re-approval.
  await age(db, id, '8 days');
  assert.match(await reason(as(db, 'app_rw', userCtx(t), () => db.query(`UPDATE lead_drafts SET approved_at = now() WHERE id = $1`, [id]))), /approved_at is set by the approval/);
  assert.match(await reason(sendLead(db, t, id)), /older than 7 days/);
  // A re-approval by another approver restamps it: the stale draft is approved again in the proper way.
  const other = (await one(db, `INSERT INTO users (idp_uid, email) VALUES ('uid-re', 're@example.test') RETURNING id`)).id;
  await db.query(`INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'operator')`, [t.org, other]);
  await as(db, 'app_rw', userCtx(t, other), () => db.query(`UPDATE lead_drafts SET approved_by = $2 WHERE id = $1`, [id, other]));
  assert.equal(await refused(sendLead(db, t, id)), null, 'a re-approval by another approver is a fresh approval');
});

// ─── V-45 P3-2: a lead message takes the same locks as an enrollment message ─────────────────────────────────────────
test('a lead message takes the org lock and the global lock shared, as the enrollment shape does', async () => {
  const { db, t } = await fresh('a');
  const l = await approvedLead(db, t, 'lk-1');
  const held = () => q(db, `SELECT mode, ((classid::bigint << 32) | objid::bigint) AS key FROM pg_locks WHERE locktype = 'advisory' AND granted`);
  const modesOn = async (key) => (await held()).filter((x) => String(x.key) === key).map((x) => x.mode);
  const orgKey = String((await one(db, `SELECT org_lock_key($1) AS k`, [t.org])).k);
  const globalKey = String((await one(db, `SELECT org_lock_key(NULL) AS k`)).k);
  await db.query('BEGIN');
  try {
    assert.equal(await refused(sendLead(db, t, l.id)), null);
    assert.deepEqual(await modesOn(orgKey), ['ShareLock'], 'org key shared');
    assert.deepEqual(await modesOn(globalKey), ['ShareLock'], 'global key shared');
  } finally { await db.query('ROLLBACK'); }
});

// ─── 3a follow-ups folded in ─────────────────────────────────────────────────────────────────────────────────────
test('TRUNCATE lead_events CASCADE is stopped by the trigger, not only the foreign key (3a P3-1)', async () => {
  const { db } = await fresh('a');
  assert.match(await reason(db.query(`TRUNCATE lead_events CASCADE`)), /never deleted/);
});

test('guard_owner reads every table the lead branch needs under FORCE RLS (a missing policy would deny it here)', async () => {
  const { db, t } = await fresh('a');
  await approvedLead(db, t, 'rls-1');
  await db.exec('SET ROLE guard_owner');
  try {
    for (const tbl of ['lead_drafts', 'lead_events', 'memberships', 'contacts', 'workspaces', 'messages', 'holds', 'mailboxes']) {
      const n = Number((await db.query(`SELECT count(*) AS n FROM ${tbl}`)).rows[0].n);
      assert.ok(n >= 1, `${tbl} visible to guard_owner`);
    }
  } finally { await db.exec('RESET ROLE'); }
});

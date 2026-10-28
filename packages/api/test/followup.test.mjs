// Level B (0008): out-of-office snooze and wake, SLA escalation once per channel, no-show reschedule draft.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApi } from './helpers.mjs';
import { returnDateFrom } from '../src/services/reply-rules.mjs';
import { wakeSnoozed, escalateSla } from '../src/services/inbox.mjs';
import { sendDraft } from '../../sender/src/send.mjs';

let api;
before(async () => { api = await startApi(); });
after(async () => { await api.stop(); });

// A new contact of our own (the demo seed has few unsent first touches): enrolled, a follow-up drafted through the
// gate, approved, and sent with a capture adapter. Returns the Reply-To the prospect would answer and the contact id.
let seq = 0;
async function freshThread() {
  seq++;
  const email = `lead${seq}.${Date.now()}@followup-${seq}.example`;
  const c = await api.call('POST', `${api.W}/contacts`, { body: { contacts: [{ name: `Dana Lee ${seq}`, email, company: `Followup ${seq}` }] } });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const contactId = c.body.created[0].id;
  await api.q(`UPDATE contacts SET email_status = 'valid' WHERE id = $1`, [contactId]);  // the vendor check the guard requires
  const [camp] = await api.q(`SELECT id FROM campaigns WHERE workspace_id = $1 LIMIT 1`, [api.demo.workspaces[0]]);
  const en = await api.call('POST', `${api.W}/campaigns/${camp.id}/enrollments`, { body: { contactIds: [contactId] } });
  const d = await api.call('POST', `${api.W}/drafts`, { body: { enrollmentId: en.body.enrolled[0].id, step: 1, subject: 'Re: Quick question',
    body: 'Hi Dana, just bringing this back to the top of your inbox. Is next week any better?' } });
  assert.equal(d.body.gate, 'passed', JSON.stringify(d.body));
  assert.equal((await api.call('POST', `${api.W}/approvals/${d.body.id}/approve`)).status, 200);
  let raw = '';
  const out = await sendDraft(api.db, { orgId: api.demo.org, workspaceId: api.demo.workspaces[0], draftId: d.body.id, mailboxId: api.demo.mailbox,
    adapter: { async send(m) { raw = m.raw; return { providerMessageId: 'test' }; } },
    urls: { unsubscribeBase: 'https://app.test', replyDomain: 'reply.omnisdr.com' } });
  assert.equal(out.outcome, 'sent', out.reason);
  return { to: /^Reply-To: (.+)$/mi.exec(raw)[1].trim(), contactId };
}
const enrollment = async (contactId) => (await api.q(`SELECT state, resume_state, stop_reason, next_run_at FROM enrollments WHERE contact_id = $1`, [contactId]))[0];

// ─── the return-date parser ─────────────────────────────────────────────────────────────────────────────────────
test('return date: the forms people write, wake at 09:00 local on a weekday; nothing believed past 180 days', () => {
  const now = new Date('2026-10-02T15:00:00Z');   // Friday 2 October 2026, 10:00 in Chicago
  const at = (t, tz = 'America/Chicago') => returnDateFrom(t, now, tz)?.toISOString() ?? null;
  assert.equal(at("I'm out of the office until October 14 with limited access."), '2026-10-14T14:00:00.000Z');
  assert.equal(at('On vacation through Oct 9.'), '2026-10-12T14:00:00.000Z', 'through Fri 9 → back Sat 10 → first weekday Mon 12');
  assert.equal(at('Away until Monday.'), '2026-10-05T14:00:00.000Z');
  assert.equal(at('I return on 10/20.'), '2026-10-20T14:00:00.000Z');
  assert.equal(at('Out until the 15th.'), '2026-10-15T14:00:00.000Z');
  assert.equal(at('back tomorrow'), '2026-10-05T14:00:00.000Z', 'tomorrow is Saturday → Monday');
  assert.equal(at('I will be back in the office on Oct 13'), '2026-10-13T14:00:00.000Z');
  assert.equal(at('I am on parental leave until January 2027.'), '2027-01-01T15:00:00.000Z', 'CST in January');
  assert.equal(at('Estoy fuera de la oficina hasta el 20 de octubre.'), '2026-10-20T14:00:00.000Z');
  assert.equal(at('Out until October 14.', 'Europe/London'), '2026-10-14T08:00:00.000Z', "the workspace's own 09:00");
  assert.equal(at("Thanks for your email, I'm traveling this week."), null);
  assert.equal(at('until may 3'), null, 'next May is past 180 days');
  assert.equal(at('until September 1'), null, 'a past date rolls to next year, which is too far');
  assert.equal(at('until 13/45'), null);
});

// ─── snooze and wake ────────────────────────────────────────────────────────────────────────────────────────────
test('an out-of-office snoozes to the return date; with no date, a week; a later one extends, an earlier one never shortens', async () => {
  const t = await freshThread();
  const at = new Date();
  assert.equal((await api.signedInbound({ to: t.to, body: 'Thanks for your email. I am out of the office with limited access to email.', receivedAt: at.toISOString() })).body.outcome, 'recorded');
  let e = await enrollment(t.contactId);
  assert.equal(e.state, 'snoozed');
  assert.equal(e.stop_reason, 'ooo_snooze');
  assert.equal(new Date(e.next_run_at).getTime(), at.getTime() + 7 * 86400000, 'no date: the default week');
  const resume = e.resume_state;
  assert.ok(['waiting', 'drafting', 'awaiting_approval', 'scheduled', 'sent'].includes(resume), `remembers ${resume}`);
  // A second auto-reply naming a date 3 days out doesn't bring the wake-up forward...
  // The day name is taken from the clock, three days out, so it never resolves to a day past the default week (a fixed "Monday"
  // resolves to next Monday 09:00 when the test runs on a Monday morning, later than at+7d).
  const soon = new Date(Date.now() + 3 * 86400000).toLocaleString('en-US', { weekday: 'long', timeZone: 'America/Chicago' });
  await api.signedInbound({ to: t.to, body: `Automatic reply: back ${soon}.`, receivedAt: new Date().toISOString() });
  assert.equal(new Date((await enrollment(t.contactId)).next_run_at).getTime(), at.getTime() + 7 * 86400000);
  // ...and one naming a later date pushes it out, keeping the remembered state.
  const later = new Date(Date.now() + 40 * 86400000);
  const month = later.toLocaleString('en-US', { month: 'long', timeZone: 'America/Chicago' });
  const day = Number(later.toLocaleString('en-US', { day: 'numeric', timeZone: 'America/Chicago' }));
  await api.signedInbound({ to: t.to, body: `I am out of the office until ${month} ${day}.`, receivedAt: new Date().toISOString() });
  e = await enrollment(t.contactId);
  assert.ok(new Date(e.next_run_at) > new Date(at.getTime() + 30 * 86400000), 'extended');
  assert.equal(e.resume_state, resume);
});

test('a paused or stopped sequence is not snoozed by an out-of-office', async () => {
  const t = await freshThread();
  await api.q(`UPDATE enrollments SET state = 'paused' WHERE contact_id = $1`, [t.contactId]);
  await api.signedInbound({ to: t.to, body: 'Out of office until Monday.', receivedAt: new Date().toISOString() });
  assert.equal((await enrollment(t.contactId)).state, 'paused');
});

test('wake: a snoozed sequence whose date has come goes back to the state it had; one still asleep stays asleep', async () => {
  const a = await freshThread();
  const b = await freshThread();
  await api.signedInbound({ to: a.to, body: 'Out of office until Monday.', receivedAt: new Date().toISOString() });
  await api.signedInbound({ to: b.to, body: 'Out of office until Monday.', receivedAt: new Date().toISOString() });
  const was = (await enrollment(a.contactId)).resume_state;
  await api.q(`UPDATE enrollments SET next_run_at = now() - interval '1 minute' WHERE contact_id = $1`, [a.contactId]);
  assert.equal(await wakeSnoozed(api.db), 1);
  const ea = await enrollment(a.contactId);
  assert.deepEqual([ea.state, ea.resume_state, ea.stop_reason], [was, null, null]);
  assert.equal((await enrollment(b.contactId)).state, 'snoozed');
  assert.equal(await wakeSnoozed(api.db), 0, 'nothing else is due');
});

// ─── SLA escalation ─────────────────────────────────────────────────────────────────────────────────────────────
test('SLA: in-app with the reply, push with an hour left, email at the breach; each once; a handled reply goes no further', async () => {
  const t = await freshThread();
  const rec = await api.signedInbound({ to: t.to, body: 'Can we set up a call Thursday?', receivedAt: new Date().toISOString() });
  const id = rec.body.id;
  const [{ sla_due_at: due }] = await api.q(`SELECT sla_due_at FROM inbound_messages WHERE id = $1`, [id]);
  assert.ok(due, 'a meeting request starts an SLA');
  const steps = async () => (await api.q(`SELECT channel FROM notifications WHERE inbound_message_id = $1 ORDER BY created_at, channel`, [id])).map((r) => r.channel);
  assert.deepEqual(await steps(), ['in_app'], 'in-app is written with the reply');
  const dueMs = new Date(due).getTime();
  await escalateSla(api.db, { now: new Date(dueMs - 61 * 60000) });
  assert.deepEqual(await steps(), ['in_app'], 'no push before the last hour');
  await escalateSla(api.db, { now: new Date(dueMs - 59 * 60000) });
  assert.deepEqual((await steps()).sort(), ['in_app', 'push']);
  await escalateSla(api.db, { now: new Date(dueMs + 1000) });
  await escalateSla(api.db, { now: new Date(dueMs + 5000) });
  assert.deepEqual((await steps()).sort(), ['email', 'in_app', 'push'], 'each step once, however often the job runs');
  const events = await api.q(`SELECT key FROM outbox WHERE topic = 'notify.sla' AND key LIKE $1 ORDER BY key`, [`${id}:%`]);
  assert.deepEqual(events.map((e) => e.key), [`${id}:email`, `${id}:push`], 'push and email go to the notify relay once each');
  // In-app: the team sees it and marks it read; a client viewer can't; another workspace's id is 404.
  const list = await api.call('GET', `${api.W}/notifications`);
  const mine = list.body.items.find((n) => n.inboundMessageId === id);
  assert.ok(mine && mine.channel === 'in_app' && mine.contactName);
  assert.equal((await api.call('GET', `${api.W}/notifications`, { as: 'client@example.com' })).status, 403);
  assert.equal((await api.call('POST', `${api.ws(1)}/notifications/${mine.id}/read`)).status, 404);
  assert.equal((await api.call('POST', `${api.W}/notifications/${mine.id}/read`, { as: 'riley@example.com' })).status, 200);
  assert.ok(!(await api.call('GET', `${api.W}/notifications`)).body.items.some((n) => n.id === mine.id));

  const t2 = await freshThread();
  const rec2 = await api.signedInbound({ to: t2.to, body: 'Happy to talk, send me some times.', receivedAt: new Date().toISOString() });
  assert.equal((await api.call('POST', `${api.W}/inbox/${rec2.body.id}/handle`)).status, 200);
  await escalateSla(api.db, { now: new Date(Date.now() + 30 * 86400000) });
  assert.deepEqual((await api.q(`SELECT channel FROM notifications WHERE inbound_message_id = $1`, [rec2.body.id])).map((r) => r.channel), ['in_app'],
    'handled before the hour: no push, no email');
});

// ─── no-show ────────────────────────────────────────────────────────────────────────────────────────────────────
test('no-show: the sequence reopens and a reschedule note waits in Approvals, gated, once; never sent by itself', async () => {
  const t = await freshThread();
  const rec = await api.signedInbound({ to: t.to, body: 'Sure, let us set up a call.', receivedAt: new Date().toISOString() });
  const start = new Date(Date.now() + 86400e3);
  const m = await api.call('POST', `${api.W}/inbox/${rec.body.id}/meeting`, { body: { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 1800e3).toISOString() } });
  assert.equal(m.status, 201);
  assert.equal((await enrollment(t.contactId)).state, 'converted');

  const ns = await api.call('PATCH', `${api.W}/meetings/${m.body.id}`, { body: { status: 'no_show' } });
  assert.equal(ns.status, 200, JSON.stringify(ns.body));
  assert.equal(ns.body.status, 'no_show');
  assert.equal(ns.body.reschedule.gate, 'passed');
  assert.equal((await enrollment(t.contactId)).state, 'awaiting_approval');
  const [d] = await api.q(`SELECT status, step, subject, body, purpose, agent_id FROM drafts WHERE id = $1`, [ns.body.reschedule.draftId]);
  assert.equal(d.status, 'review', 'waits for a person; nothing approves it automatically');
  assert.ok(d.agent_id, 'the reschedule note is credited to the workspace SDR agent');
  assert.equal(d.purpose, 'reschedule', 'the send loop sends it once approved, without the sequence wait (#45 audit)');
  assert.ok(d.step >= 1);
  assert.match(d.subject, /^Re: /);
  assert.doesNotMatch(d.body, /\d/, 'no numbers, nothing to cite');
  const card = await api.call('GET', `${api.W}/approvals/${ns.body.reschedule.draftId}`);
  assert.equal(card.status, 200);
  assert.equal(card.body.purpose, 'reschedule', 'the card says why it is there');

  // Once: marking it no-show again, or completing it, drafts nothing more.
  const again = await api.call('PATCH', `${api.W}/meetings/${m.body.id}`, { body: { status: 'no_show' } });
  assert.equal(again.body.reschedule, undefined);
  const [{ n }] = await api.q(`SELECT count(*)::int AS n FROM drafts d JOIN enrollments e ON e.id = d.enrollment_id WHERE e.contact_id = $1 AND d.body LIKE 'Hi%missed each other%'`, [t.contactId]);
  assert.equal(n, 1);
  // A client viewer can't trigger it (inbox_draft).
  assert.equal((await api.call('PATCH', `${api.W}/meetings/${m.body.id}`, { as: 'client@example.com', body: { status: 'no_show' } })).status, 403);
});

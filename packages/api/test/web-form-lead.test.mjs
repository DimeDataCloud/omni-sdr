// S2L-2b: the web-form adapter. One submission is a message AND a lead event, in one transaction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../../db/src/migrate.mjs';
import { seedDemo } from '../src/seed-demo.mjs';
import { ingestFormLead, webFormAdapter } from '../src/leads/web-form.mjs';
import { ingestForm } from '../src/services/inbox.mjs';

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const TOKEN = 'form-token-' + 'x'.repeat(30);

async function setup() {
  const db = new PGlite();
  await migrate(db);
  const demo = await seedDemo(db);
  const ws = demo.workspaces[0];
  // lead_events refuses DELETE (0023); this test-only reset switches that trigger off for one statement, as a superuser can.
  await db.exec('ALTER TABLE lead_events DISABLE TRIGGER lead_events_no_delete');
  await db.query('DELETE FROM lead_events');
  await db.exec('ALTER TABLE lead_events ENABLE TRIGGER lead_events_no_delete');
  const hook = (await db.query(`INSERT INTO inbound_hooks (org_id, workspace_id, name, token_hash) VALUES ($1, $2, 'site', $3) RETURNING id`,
    [demo.org, ws, sha(TOKEN)])).rows[0].id;
  return { db, demo, ws, hook, h: { id: hook, tokenHash: sha(TOKEN) } };
}
const rows = async (db, sql, p) => (await db.query(sql, p)).rows;
const count = async (db, table) => (await rows(db, `SELECT count(*)::int AS n FROM ${table}${table === 'inbound_messages' ? " WHERE channel = 'form'" : ''}`))[0].n;
const sub = (o = {}) => ({ body: 'Hi, can you quote a kitchen remodel?', email: 'Lena@Example.test', name: 'Lena', phone: '615 555 0100', page: '/remodel', externalId: 'form-sub-1', receivedAt: new Date(), ...o });

test('one submission is one message and one lead event, linked by one external id; the text stays in the message', async () => {
  const { db, h, ws } = await setup();
  const out = await ingestFormLead(db, h, sub());
  assert.equal(out.outcome, 'recorded');
  assert.deepEqual([out.lead.outcome, out.lead.touchBlocker], ['recorded', null], 'express consent and a known contact: a touch is allowed');
  const [m] = await rows(db, `SELECT channel, external_id, body, from_address FROM inbound_messages WHERE channel = 'form'`);
  const [l] = await rows(db, `SELECT source, channel, consent_basis, external_id, payload, contact_id FROM lead_events`);
  assert.deepEqual([m.channel, m.external_id, m.from_address], ['form', 'form-sub-1', 'lena@example.test']);
  assert.deepEqual([l.source, l.channel, l.consent_basis, l.external_id, l.payload], ['web_form', 'form', 'express_form', 'form-sub-1', { page: '/remodel' }]);
  assert.ok(l.contact_id, 'the submitter is a contact');
  assert.equal((await rows(db, `SELECT 1 FROM lead_events WHERE payload::text LIKE '%kitchen%' OR payload::text LIKE '%Lena%' OR payload::text LIKE '%615%'`)).length, 0, 'no message text or identity in the lead payload');
  assert.equal((await rows(db, `SELECT 1 FROM contacts WHERE workspace_id = $1 AND email = 'lena@example.test'`, [ws])).length, 1);
});

test('no form id: a server-generated submission id is shared by both rows; an address-like id is hashed in both', async () => {
  const { db, h } = await setup();
  await ingestFormLead(db, h, sub({ externalId: undefined, email: 'a@example.test' }));
  await ingestFormLead(db, h, sub({ externalId: 'pat@example.test', email: 'b@example.test' }));
  await ingestFormLead(db, h, sub({ externalId: '6155550100', email: 'c@example.test' }));
  const pairs = await rows(db, `SELECT m.external_id AS m, l.external_id AS l FROM inbound_messages m JOIN lead_events l ON l.workspace_id = m.workspace_id AND l.external_id = m.external_id WHERE m.channel = 'form' ORDER BY m.received_at, m.id`);
  assert.equal(pairs.length, 3, 'each message joins its lead on the shared external id');
  assert.ok(pairs.some((p) => /^sub-[0-9a-f-]{36}$/.test(p.m)), 'generated submission id');
  assert.equal(pairs.filter((p) => /^h:[0-9a-f]{32}$/.test(p.m)).length, 2, 'address-like and phone-like ids hashed');
  assert.equal((await rows(db, `SELECT 1 FROM inbound_messages WHERE channel = 'form' AND (external_id LIKE '%@%' OR external_id = '6155550100')`)).length, 0);
});

test('a page that looks like identity is left out of the lead, and the submission is still recorded in full', async () => {
  const { db, h } = await setup();
  const out = await ingestFormLead(db, h, sub({ page: 'contact pat@example.test' }));
  assert.equal(out.outcome, 'recorded');
  assert.deepEqual((await rows(db, `SELECT payload FROM lead_events`))[0].payload, {});
  assert.match((await rows(db, `SELECT subject FROM inbound_messages WHERE channel = 'form'`))[0].subject, /pat@example\.test/, 'the text keeps it');
});

test('a retry is a duplicate: one message, one lead event; an unknown or wrong-token hook writes nothing', async () => {
  const { db, h, hook } = await setup();
  assert.equal((await ingestFormLead(db, h, sub())).outcome, 'recorded');
  const again = await ingestFormLead(db, h, sub());
  assert.equal(again.outcome, 'duplicate');
  assert.equal(again.lead, undefined);
  assert.deepEqual([await count(db, 'inbound_messages'), await count(db, 'lead_events')], [1, 1]);
  assert.deepEqual(await ingestFormLead(db, { id: hook, tokenHash: sha('wrong') }, sub({ externalId: 'x-2' })), { outcome: 'unknown_hook' });
  assert.deepEqual(await ingestFormLead(db, { id: '00000000-0000-4000-8000-000000000000', tokenHash: sha(TOKEN) }, sub({ externalId: 'x-3' })), { outcome: 'unknown_hook' });
  assert.deepEqual([await count(db, 'inbound_messages'), await count(db, 'lead_events')], [1, 1]);
});

test('a submission with no address is a lead with no contact: recorded, and not touchable', async () => {
  const { db, h } = await setup();
  const out = await ingestFormLead(db, h, sub({ email: undefined, externalId: 'anon-1' }));
  assert.deepEqual([out.outcome, out.lead.touchBlocker], ['recorded', 'no_contact']);
  assert.equal((await rows(db, `SELECT contact_id FROM lead_events`))[0].contact_id, null);
});

test('atomic: a failure writing the lead event leaves no message, contact, stop or outbox row; a retry then records both', async () => {
  const { db, h } = await setup();
  const before = { msgs: await count(db, 'inbound_messages'), contacts: await count(db, 'contacts'), outbox: await count(db, 'outbox') };
  await db.exec(`CREATE FUNCTION boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$;
                 CREATE TRIGGER boom BEFORE INSERT ON lead_events FOR EACH ROW EXECUTE FUNCTION boom()`);
  await assert.rejects(ingestFormLead(db, h, sub({ email: 'fresh@example.test' })), /boom/);
  assert.deepEqual({ msgs: await count(db, 'inbound_messages'), contacts: await count(db, 'contacts'), outbox: await count(db, 'outbox') }, before, 'no orphan message');
  assert.equal(await count(db, 'lead_events'), 0);
  await db.exec('DROP TRIGGER boom ON lead_events');
  const retry = await ingestFormLead(db, h, sub({ email: 'fresh@example.test' }));
  assert.equal(retry.outcome, 'recorded', 'the same submission is not blocked by the failed attempt');
  assert.deepEqual([await count(db, 'inbound_messages'), await count(db, 'lead_events')], [before.msgs + 1, 1]);
});

test('atomic, the reverse: a failure writing the message leaves no lead event', async () => {
  const { db, h } = await setup();
  await db.exec(`CREATE FUNCTION boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$;
                 CREATE TRIGGER boom BEFORE INSERT ON inbound_messages FOR EACH ROW EXECUTE FUNCTION boom()`);
  await assert.rejects(ingestFormLead(db, h, sub()), /boom/);
  assert.deepEqual([await count(db, 'inbound_messages'), await count(db, 'lead_events')], [0, 0]);
  await db.exec('DROP TRIGGER boom ON inbound_messages');
  assert.equal((await ingestFormLead(db, h, sub())).outcome, 'recorded');
});

test('ingestForm still works on its own, and refuses a caller transaction without the resolved hook', async () => {
  const { db, h } = await setup();
  assert.equal((await ingestForm(db, h, sub({ externalId: 'plain-1' }))).outcome, 'recorded');
  assert.equal(await count(db, 'lead_events'), 0, 'the plain path writes no lead event (the route is not rewired)');
  await assert.rejects(ingestForm(db, h, sub(), { tx: db }), /needs the resolved hook/);
});

test('adapter: a submission is verified only after the hook token was proved', async () => {
  assert.equal(webFormAdapter.verify({ hookVerified: true }), true);
  assert.equal(webFormAdapter.verify({}), false);
  assert.equal(webFormAdapter.source, 'web_form');
});

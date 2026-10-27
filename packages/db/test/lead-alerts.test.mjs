// 0030: widening notifications.kind must never drop a kind an earlier migration allowed (0016's handoff_overdue was lost once).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, copyFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../src/migrate.mjs';

const MIGRATIONS = new URL('../migrations/', import.meta.url);
const kinds = async (db) => {
  const def = (await db.query(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'notifications_kind_check'`)).rows[0].d;
  return [...def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
};

test('0030: every notification kind allowed at 0029 is still allowed, and a database holding such a row migrates', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-0029-'));
  for (const f of (await readdir(MIGRATIONS)).filter((x) => x.endsWith('.sql') && x < '0030')) await copyFile(new URL(f, MIGRATIONS), join(dir, f));
  const db = new PGlite();
  await migrate(db, dir);
  const before = await kinds(db);
  assert.ok(before.includes('sla_meeting') && before.includes('handoff_overdue'), `the constraint at 0029 is ${before}`);
  // A row of every old kind (a handoff row needs a handoff; a plain message row needs a reply: use the superuser and defer FKs by
  // inserting only what the CHECK is about, with RLS and FKs out of the way).
  await db.exec(`ALTER TABLE notifications DISABLE ROW LEVEL SECURITY`);
  await db.exec(`SET session_replication_role = replica`);
  const org = '00000000-0000-4000-8000-0000000000a1';
  const ws = '00000000-0000-4000-8000-0000000000b1';
  const msg = '00000000-0000-4000-8000-0000000000c1';
  for (const k of before) {
    // notifications_kind_subject (0016): a handoff_overdue row names a handoff, every other kind names a message.
    const handoff = k === 'handoff_overdue';
    await db.query(`INSERT INTO notifications (org_id, workspace_id, inbound_message_id, handoff_id, kind, channel, due_at)
                    VALUES ($1, $2, $3, $4, $5, 'in_app', now())`, [org, ws, handoff ? null : msg, handoff ? msg : null, k]);
  }
  await db.exec(`SET session_replication_role = origin`);
  await db.exec(`ALTER TABLE notifications ENABLE ROW LEVEL SECURITY`);
  const ran = await migrate(db);
  assert.ok(ran.ran.includes('0030_lead_alerts.sql'));
  const after = await kinds(db);
  for (const k of before) assert.ok(after.includes(k), `kind ${k} was dropped by 0030: ${after}`);
  assert.ok(after.includes('new_lead'));
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM notifications`)).rows[0].n, before.length, 'old rows survive');
});

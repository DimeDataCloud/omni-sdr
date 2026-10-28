// Local dev server: PGlite in memory, the demo tenant, and dev sign-in, on 127.0.0.1 only.
// For Christian and Gemini to point the console UI at a real backend while designing.
//
//   npm run dev                          → http://127.0.0.1:8787
//   Authorization: Bearer dev:maya@example.com      (admin; also sam@ operator, riley@ reviewer, client@ client_viewer)
//   OMNI_FIREBASE_PROJECT=<id>           also accept real Identity Platform / Firebase ID tokens
//   OMNI_CORS_ORIGINS=https://...        extra browser origins (localhost:3000 and :5173 are allowed by default)
//   OMNI_PGLITE_DIR=./.devdb             keep data between restarts (default: fresh every start)
//   OMNI_DEV_MODEL=rules                 a deterministic stand-in model (services/devfakes.mjs) instead of none
//   OMNI_DEV_CREDITS=<n>                every new org gets n action and data credits (there is no trial; DECISIONS 2026-10-02)
//   OMNI_DEV_FIXTURES=1                  research, enrichment, lead finding and email checks use fixtures instead of the network
//                                        (the stand-in email vendor passes every address that isn't role@ or bounce@)
import { createServer } from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../../db/src/migrate.mjs';
import { createApp } from './app.mjs';
import { pglitePool } from './pool.mjs';
import { devVerifier, firebaseVerifier } from './auth.mjs';
import { offModel } from './services/model.mjs';
import { rulesModel, fixtureFetch, fixtureMx, FIXTURE_PLACES } from './services/devfakes.mjs';
import { fakeVerifier } from './services/verify.mjs';
import { fakePlaces } from './services/places.mjs';
import { seedDemo } from './seed-demo.mjs';

const env = process.env;
if (env.NODE_ENV === 'production') {
  console.error('dev.mjs refuses to run with NODE_ENV=production (it accepts unsigned dev tokens). Use server.mjs.');
  process.exit(1);
}
const HOST = '127.0.0.1';   // never 0.0.0.0: dev tokens are unsigned
const PORT = Number(env.PORT ?? 8787);

const db = env.OMNI_PGLITE_DIR ? new PGlite(env.OMNI_PGLITE_DIR) : new PGlite();
const { ran } = await migrate(db);
const seeded = await seedDemo(db);
// No trial in the product (DECISIONS 2026-10-02): new orgs start with no credits. For local runs (the acceptance
// script signs up fresh orgs), OMNI_DEV_CREDITS=<n> grants n action and data credits to every new org, through the
// ledger. Dev only: this trigger is created here, never by a migration.
if (Number(env.OMNI_DEV_CREDITS) > 0) {
  const n = Math.min(Math.floor(Number(env.OMNI_DEV_CREDITS)), 100000);
  await db.exec(`CREATE OR REPLACE FUNCTION dev_grant_credits() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
    BEGIN
      INSERT INTO credit_balances (org_id, meter, balance) VALUES (NEW.id, 'action', ${n}), (NEW.id, 'data', ${n})
        ON CONFLICT (org_id, meter) DO UPDATE SET balance = credit_balances.balance + EXCLUDED.balance;
      INSERT INTO credit_ledger (org_id, meter, delta, kind, ref_type) VALUES (NEW.id, 'action', ${n}, 'grant', 'dev'), (NEW.id, 'data', ${n}, 'grant', 'dev');
      RETURN NEW;
    END $f$;
    DROP TRIGGER IF EXISTS dev_grant_credits ON orgs;
    CREATE TRIGGER dev_grant_credits AFTER INSERT ON orgs FOR EACH ROW EXECUTE FUNCTION dev_grant_credits();`);
}

const dev = devVerifier();
const fb = env.OMNI_FIREBASE_PROJECT ? firebaseVerifier({ projectId: env.OMNI_FIREBASE_PROJECT }) : null;
const verifyToken = (token) => (fb && token.split('.').length === 3 ? fb(token) : dev(token));

const app = createApp({
  pool: pglitePool(db),
  verifyToken,
  tokenFrom: (req) => /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? null,   // dev only: never in server.mjs
  model: env.OMNI_DEV_MODEL === 'rules' ? rulesModel() : offModel(),
  config: {
    corsOrigins: ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://127.0.0.1:5173',
      ...(env.OMNI_CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)],
    appUrl: `http://${HOST}:${PORT}`,
    unsubscribeBase: `http://${HOST}:${PORT}`,
    inboundSecret: env.OMNI_INBOUND_SECRET || null,
    ...(env.OMNI_DEV_FIXTURES === '1' ? { fetchPage: fixtureFetch, places: fakePlaces(FIXTURE_PLACES), resolveMx: fixtureMx,
      verifier: fakeVerifier((e) => (/^bounce@/.test(e) ? 'invalid' : /^(info|office|frontdesk)@/.test(e) ? 'risky' : 'valid')) } : {}),
  },
  log: (e) => { if (e.level === 'error' || env.OMNI_LOG === '1') console.log(JSON.stringify(e)); },
});

createServer((req, res) => { app.handle(req, res); }).listen(PORT, HOST, () => {
  console.log(`omni-api dev on http://${HOST}:${PORT}  (migrations run: ${ran.length}, demo seeded: ${seeded ? 'yes' : 'already there'})`);
  if (seeded) {
    console.log(`  org ${seeded.org}`);
    console.log(`  workspaces ${seeded.workspaces.join(', ')}`);
  }
  console.log('  sign in with: Authorization: Bearer dev:maya@example.com   then GET /v1/me');
});

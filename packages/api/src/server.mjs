// Production entry (Cloud Run). Nothing here is deployed by an agent: deploying is Christian's call (Rails §3).
// Config is environment only; secrets arrive from Secret Manager as env vars, never files in the repo.
//
//   DATABASE_URL            Cloud SQL connection (login role: member of app_rw, gate_svc, sender_svc, inbox_svc only)
//   OMNI_FIREBASE_PROJECT   Identity Platform project id; ID tokens must have this audience
//   OMNI_CORS_ORIGINS       comma-separated exact origins allowed to call the API from a browser
//   OMNI_APP_URL            base for invite links (default https://app.omnisdr.com)
//   OMNI_UNSUBSCRIBE_BASE   base for /u/<token> links
//   OMNI_INBOUND_SECRET     HMAC key shared with the email-worker; /internal/* is 404 without it
//   OMNI_TRUST_PROXY=1      take the client IP from X-Forwarded-For (behind Cloud Run's front end) [VERIFY hop count]
//   OMNI_MODEL=off|vertex   default off; vertex needs OMNI_VERTEX_PROJECT and OMNI_MODEL_{FLASH_LITE,FLASH,PRO} [VERIFY IDs]
import { createServer } from 'node:http';
import { createApp } from './app.mjs';
import { pgPool } from './pool.mjs';
import { firebaseVerifier } from './auth.mjs';
import { offModel, vertexModel } from './services/model.mjs';

const env = process.env;
const need = (k) => { if (!env[k]) { console.error(`missing ${k}`); process.exit(1); } return env[k]; };

export async function main() {
  const pool = await pgPool({ connectionString: need('DATABASE_URL'), max: Number(env.OMNI_DB_POOL ?? 10) });
  const model = env.OMNI_MODEL === 'vertex'
    ? vertexModel({ project: need('OMNI_VERTEX_PROJECT'), location: env.OMNI_VERTEX_LOCATION ?? 'us-central1',
      models: { flash_lite: need('OMNI_MODEL_FLASH_LITE'), flash: need('OMNI_MODEL_FLASH'), pro: need('OMNI_MODEL_PRO') } })
    : offModel();
  const app = createApp({
    pool,
    verifyToken: firebaseVerifier({ projectId: need('OMNI_FIREBASE_PROJECT') }),
    model,
    config: {
      corsOrigins: (env.OMNI_CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      appUrl: env.OMNI_APP_URL ?? 'https://app.omnisdr.com',
      unsubscribeBase: env.OMNI_UNSUBSCRIBE_BASE ?? 'https://app.omnisdr.com',
      inboundSecret: env.OMNI_INBOUND_SECRET || null,
      trustProxy: env.OMNI_TRUST_PROXY === '1',
    },
    log: (entry) => console.log(JSON.stringify({ severity: entry.level === 'error' ? 'ERROR' : 'INFO', ...entry })),
  });
  const server = createServer((req, res) => { app.handle(req, res); });
  server.requestTimeout = 60000;
  server.headersTimeout = 20000;
  const port = Number(env.PORT ?? 8080);
  server.listen(port, () => console.log(JSON.stringify({ severity: 'INFO', msg: `omni-api listening on ${port}`, model: model.name })));
  const stop = () => server.close(() => pool.end().finally(() => process.exit(0)));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('server.mjs')) main();

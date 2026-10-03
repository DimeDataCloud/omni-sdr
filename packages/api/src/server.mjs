// Production entry (Cloud Run). Nothing here is deployed by an agent: deploying is Christian's call (Rails §3).
// Config is environment only; secrets arrive from Secret Manager as env vars, never files in the repo.
//
//   DATABASE_URL            Cloud SQL connection (login role: member of app_rw, gate_svc, sender_svc, inbox_svc only)
//   OMNI_FIREBASE_PROJECT   Identity Platform project id; ID tokens must have this audience
//   OMNI_CORS_ORIGINS       comma-separated exact origins allowed to call the API from a browser
//   OMNI_APP_URL            base for invite links (default https://app.omnisdr.com)
//   OMNI_UNSUBSCRIBE_BASE   base for /u/<token> links
//   OMNI_INBOUND_SECRET     HMAC key shared with the email-worker; /internal/* is 404 without it
//   OMNI_EDGE_SECRET        HMAC key shared with the api.omnisdr.com Worker, which signs the caller's IP (#52 audit)
//   OMNI_TRUST_PROXY=<n>    the client IP is the n-th entry from the end of X-Forwarded-For. 1 behind Cloud Run (the live value).
//                           2 ONLY when every request must pass Cloudflare or a load balancer first: while the *.run.app URL
//                           is reachable directly, 2 lets a caller pick its own rate-limit bucket with one forged entry
//                           (claude-local's #33 audit: 60 spoofed calls never limited, vs 31 at 1). Unset: the socket address
//   OMNI_MODEL=off|vertex   default off; vertex needs OMNI_VERTEX_PROJECT and OMNI_MODEL_{FLASH_LITE,FLASH,PRO} [VERIFY IDs]
import { createServer } from 'node:http';
import { createApp } from './app.mjs';
import { pgPool } from './pool.mjs';
import { firebaseVerifier } from './auth.mjs';
import { offModel, vertexModel } from './services/model.mjs';
import { offPlaces, googlePlaces } from './services/places.mjs';
import { offVerifier } from './services/verify.mjs';
import { zeroBounceVerifier } from './services/zerobounce.mjs';

const env = process.env;
const senderSecret = (k) => {
  let v; try { v = JSON.parse(env.OMNI_SENDER_SECRETS ?? '')[k]; } catch { /* not JSON: reported below */ }
  if (!v) { console.error(`missing ${k} in OMNI_SENDER_SECRETS`); process.exit(1); }
  return v;
};
const need = (k) => { if (!env[k]) { console.error(`missing ${k}`); process.exit(1); } return env[k]; };

export async function main() {
  const pool = await pgPool({ connectionString: need('DATABASE_URL'), max: Number(env.OMNI_DB_POOL ?? 10) });
  const model = env.OMNI_MODEL === 'vertex'
    ? vertexModel({ project: need('OMNI_VERTEX_PROJECT'), location: env.OMNI_VERTEX_LOCATION ?? 'us-central1',
      models: { flash_lite: need('OMNI_MODEL_FLASH_LITE'), flash: need('OMNI_MODEL_FLASH'), pro: need('OMNI_MODEL_PRO') } })
    : offModel();
  // Vendor verification ships off: OMNI_VERIFY=zerobounce reads the key by name from OMNI_SENDER_SECRETS.zeroBounceKey
  // (Secret Manager `omni-sender-secrets`). Asked for and missing is a refusal to start, not a silent 'off'.
  const verifier = env.OMNI_VERIFY === 'zerobounce' ? zeroBounceVerifier({ key: senderSecret('zeroBounceKey') }) : offVerifier();
  // Lead finding by place ships off: OMNI_PLACES=google needs the Places API enabled and a key (Christian's call).
  const places = env.OMNI_PLACES === 'google' ? googlePlaces({ key: need('OMNI_PLACES_KEY') }) : offPlaces();
  const app = createApp({
    pool,
    verifyToken: firebaseVerifier({ projectId: need('OMNI_FIREBASE_PROJECT') }),
    model,
    config: {
      corsOrigins: (env.OMNI_CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      appUrl: env.OMNI_APP_URL ?? 'https://app.omnisdr.com',
      unsubscribeBase: env.OMNI_UNSUBSCRIBE_BASE ?? 'https://app.omnisdr.com',
      inboundSecret: env.OMNI_INBOUND_SECRET || null,
      places,
      // Free checks always run; the vendor check only with OMNI_VERIFY=zerobounce (above).
      verifier,
      // Shared with the api.omnisdr.com Worker, which signs the caller's address (app.mjs edgeIp). Unset: not trusted.
      edgeSecret: env.OMNI_EDGE_SECRET || null,
      // Number of proxies that append to X-Forwarded-For (see OMNI_TRUST_PROXY above: 1 unless run.app ingress is closed).
      trustProxy: Number(env.OMNI_TRUST_PROXY ?? 0) || false,
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

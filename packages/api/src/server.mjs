// Production entry (Cloud Run). Nothing here is deployed by an agent: deploying is Christian's call (Rails §3).
// Config is environment only; secrets arrive from Secret Manager as env vars, never files in the repo.
//
//   DATABASE_URL            Cloud SQL connection (login role: member of app_rw, gate_svc, sender_svc, inbox_svc only)
//   OMNI_FIREBASE_PROJECT   Identity Platform project id; ID tokens must have this audience
//   OMNI_CORS_ORIGINS       comma-separated exact origins allowed to call the API from a browser
//   OMNI_APP_URL            base for invite links (required: the old default, app.omnisdr.com, has no DNS record)
//   OMNI_UNSUBSCRIBE_BASE   the API's public origin, for /u/<token> and hook URLs (required, same reason)
//   OMNI_INBOUND_SECRET     HMAC key shared with the email-worker; /internal/* is 404 without it
//   OMNI_FORM_DAILY_CAP     most website-form submissions a workspace may record per 24 hours (429 over it; default 500)
//   OMNI_EDGE_SECRET        HMAC key shared with the api.omnisdr.com Worker, which signs the caller's IP (#52 audit)
//   OMNI_TRUST_PROXY=<n>    the client IP is the n-th entry from the end of X-Forwarded-For. 1 behind Cloud Run (the live value).
//                           2 ONLY when every request must pass Cloudflare or a load balancer first: while the *.run.app URL
//                           is reachable directly, 2 lets a caller pick its own rate-limit bucket with one forged entry
//                           (claude-local's #33 audit: 60 spoofed calls never limited, vs 31 at 1). Unset: the socket address
//   OMNI_MODEL=off|gemini_api   default off; gemini_api needs OMNI_GEMINI_KEY, OMNI_DATA_IS_DEMO=1 and OMNI_MODEL_{FLASH_LITE,FLASH,PRO} [VERIFY IDs]
import { createServer } from 'node:http';
import { createApp } from './app.mjs';
import { pgPool } from './pool.mjs';
import { firebaseVerifier } from './auth.mjs';
import { offModel, geminiApiModel } from './services/model.mjs';
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
  // OMNI_MODEL=gemini_api is the free Gemini API, for a demo with fake data only (Christian 2026-10-02): its terms let
  // Google use what is sent [VERIFY], so it won't start unless the deployment says its data is demo-only.
  if (env.OMNI_MODEL === 'gemini_api' && env.OMNI_DATA_IS_DEMO !== '1') {
    console.error('OMNI_MODEL=gemini_api is for demo data only: set OMNI_DATA_IS_DEMO=1 on a deployment that holds no real prospect or customer data');
    process.exit(1);
  }
  // A leftover OMNI_MODEL=vertex must stop the start, not quietly turn the model off.
  if (env.OMNI_MODEL && !['off', 'gemini_api'].includes(env.OMNI_MODEL)) {
    console.error(`OMNI_MODEL=${env.OMNI_MODEL} is not supported: use off or gemini_api (Vertex was removed)`);
    process.exit(1);
  }
  const pool = await pgPool({ connectionString: need('DATABASE_URL'), max: Number(env.OMNI_DB_POOL ?? 10) });
  const models = () => ({ flash_lite: need('OMNI_MODEL_FLASH_LITE'), flash: need('OMNI_MODEL_FLASH'), pro: need('OMNI_MODEL_PRO') });
  const model = env.OMNI_MODEL === 'gemini_api'
    ? geminiApiModel({ key: need('OMNI_GEMINI_KEY'), models: models(), perDay: Number(env.OMNI_GEMINI_PER_DAY ?? 20) || 20 })
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
      appUrl: need('OMNI_APP_URL'),
      unsubscribeBase: need('OMNI_UNSUBSCRIBE_BASE'),
      inboundSecret: env.OMNI_INBOUND_SECRET || null,
      // Most website-form submissions a workspace may record per 24 hours (429 over it). Unset: 500.
      formDailyCap: Number(env.OMNI_FORM_DAILY_CAP) >= 1 ? Math.floor(Number(env.OMNI_FORM_DAILY_CAP)) : undefined,
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

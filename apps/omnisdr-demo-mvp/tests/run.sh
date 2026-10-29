#!/bin/bash
# Full local proof: walkthrough on a high-cap instance, hardening (incl. cap tests) on a low-cap instance.
# The walkthrough instance uses Cloudflare's published always-pass Turnstile test keys, so the Start gate and the server-side siteverify path
# are exercised for real. (The production site key in wrangler.toml cannot pass on localhost.) Hardening runs with the secret unset.
cd "$(dirname "$0")/.."
rc=0
export PORT="${PORT:-8787}"; export BASE="http://localhost:$PORT"
bash tests/start.sh --var IP_CAP:50 --var DAILY_CAP:80 --var DEV_PASSCODE:test-passcode --var TRYME_GATED:off --var TURNSTILE_SITEKEY:1x00000000000000000000AA --var TURNSTILE_SECRET:1x0000000000000000000000000000000AA && node tests/walkthrough.js || rc=1
bash tests/stop.sh
bash tests/start.sh --var IP_CAP:5 --var DAILY_CAP:8 --var DEV_PASSCODE:test-passcode --var TRYME_GATED:off --var TURNSTILE_SITEKEY: && node tests/hardening.js || rc=1
bash tests/stop.sh
# Sales deck gate (SALES_PASSCODE is a test value; the real one lives only in the Worker secret).
bash tests/start.sh --var IP_CAP:50 --var DAILY_CAP:80 --var DEV_PASSCODE:test-passcode --var SALES_PASSCODE:test-sales --var TURNSTILE_SITEKEY: && node tests/sales.js || rc=1
bash tests/stop.sh
# Flag off: /tryme open without a session, / still the entry, /sales still gated.
bash tests/start.sh --var DEV_PASSCODE:test-passcode --var SALES_PASSCODE:test-sales --var TRYME_GATED:off --var TURNSTILE_SITEKEY: && node tests/tryme-open.js || rc=1
bash tests/stop.sh
# Fail-closed check: site key set, secret deliberately absent -> session start must refuse.
bash tests/start.sh --var DEV_PASSCODE:test-passcode --var TRYME_GATED:off --var TURNSTILE_SITEKEY:1x00000000000000000000AA && node tests/turnstile-failclosed.js || rc=1
bash tests/stop.sh
# Token lock-down (offline): ENGINE_B=1 with a FAKE key against the mock Google the suite starts on 127.0.0.1:$MOCK_PORT. Never reaches Google.
export MOCK_PORT="${MOCK_PORT:-8802}"; export ENGINE_B_TEST_MINTS=12; export FAKE_KEY=test-key-NOT-REAL
bash tests/start.sh --var ENGINE_B:1 --var GEMINI_API_KEY:$FAKE_KEY --var GEMINI_BASE:http://127.0.0.1:$MOCK_PORT --var SESSION_SECONDS:3 --var ENGINE_B_TEST_MINTS:$ENGINE_B_TEST_MINTS --var IP_CAP:5000 --var DAILY_CAP:5000 --var DEV_PASSCODE:test-passcode --var TRYME_GATED:off --var TURNSTILE_SITEKEY: && node tests/token-lockdown.js || rc=1
bash tests/stop.sh
# Retell voice tab: fake key, mock Retell, lifetime ceiling of 3 calls.
export RETELL_MOCK_PORT="${RETELL_MOCK_PORT:-8803}"; export RETELL_TEST_CALLS=3; export FAKE_RETELL_KEY=retell-test-key-NOT-REAL
bash tests/start.sh --var RETELL_API_KEY:$FAKE_RETELL_KEY --var RETELL_BASE:http://127.0.0.1:$RETELL_MOCK_PORT --var RETELL_TEST_CALLS:$RETELL_TEST_CALLS --var IP_CAP:5000 --var DAILY_CAP:5000 --var TRYME_GATED:off --var TURNSTILE_SITEKEY: && node tests/voice.js || rc=1
bash tests/stop.sh
# Speed-to-lead simulation: real cadence module on a simulated clock (free, no model).
bash tests/start.sh --var IP_CAP:5000 --var DAILY_CAP:5000 --var TRYME_GATED:off --var TURNSTILE_SITEKEY: && node tests/s2l.js || rc=1
bash tests/stop.sh
exit $rc

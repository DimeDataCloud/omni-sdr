#!/bin/bash
# Full local proof: walkthrough on a high-cap instance, hardening (incl. cap tests) on a low-cap instance.
# The walkthrough instance uses Cloudflare's published always-pass Turnstile test keys, so the Start gate and the server-side siteverify path
# are exercised for real. (The production site key in wrangler.toml cannot pass on localhost.) Hardening runs with the secret unset.
cd "$(dirname "$0")/.."
rc=0
bash tests/start.sh --var IP_CAP:50 --var DAILY_CAP:80 --var DEV_PASSCODE:test-passcode --var TURNSTILE_SITEKEY:1x00000000000000000000AA --var TURNSTILE_SECRET:1x0000000000000000000000000000000AA && node tests/walkthrough.js || rc=1
bash tests/stop.sh
bash tests/start.sh --var IP_CAP:5 --var DAILY_CAP:8 --var DEV_PASSCODE:test-passcode --var TURNSTILE_SITEKEY: && node tests/hardening.js || rc=1
bash tests/stop.sh
exit $rc

#!/bin/bash
# Full local proof: walkthrough on a high-cap instance, hardening (incl. cap tests) on a low-cap instance.
cd "$(dirname "$0")/.."
rc=0
bash tests/start.sh --var IP_CAP:50 --var DAILY_CAP:80 --var DEV_PASSCODE:test-passcode && node tests/walkthrough.js || rc=1
bash tests/stop.sh
bash tests/start.sh --var IP_CAP:5 --var DAILY_CAP:8 --var DEV_PASSCODE:test-passcode && node tests/hardening.js || rc=1
bash tests/stop.sh
exit $rc

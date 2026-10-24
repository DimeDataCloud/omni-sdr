#!/bin/bash
# usage: start.sh [extra wrangler args...]   (always starts with a fresh local state directory)
cd "$(dirname "$0")/.."
STATE=$(mktemp -d /tmp/mvp-state.XXXXXX)
nohup npx wrangler dev --port 8787 --local --persist-to "$STATE" "$@" > /tmp/wr.log 2>&1 &
for i in $(seq 1 40); do curl -s -m 1 localhost:8787/healthz >/dev/null && exit 0; sleep 1; done
echo "failed to start"; tail -8 /tmp/wr.log; exit 1

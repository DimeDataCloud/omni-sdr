#!/bin/bash
# usage: [PORT=8787] start.sh [extra wrangler args...]   (always starts with a fresh local state directory)
# PORT defaults to 8787; set it to run next to another session's instance. Tests read BASE (run.sh sets it from PORT).
cd "$(dirname "$0")/.."
PORT="${PORT:-8787}"
STATE=$(mktemp -d /tmp/mvp-state.XXXXXX)
nohup npx wrangler dev --port "$PORT" --local --persist-to "$STATE" "$@" > "/tmp/wr-$PORT.log" 2>&1 &
for i in $(seq 1 40); do curl -s -m 1 "localhost:$PORT/healthz" >/dev/null && exit 0; sleep 1; done
echo "failed to start"; tail -8 "/tmp/wr-$PORT.log"; exit 1

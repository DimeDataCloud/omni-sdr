#!/bin/bash
# Run against a server started with IP_CAP=1 DAILY_CAP=3
post() {
  local ip="$1"; local body="$2"
  curl -s -X POST localhost:${PORT:-8787}/api/session -H 'content-type: application/json' -H "cf-connecting-ip: $ip" -d "$body" -w ' [%{http_code}]\n' | cut -c1-150
}
echo "ip cap 1, same ip twice:"
post 9.9.9.9 '{}'
post 9.9.9.9 '{}'
echo "unknown tenant id falls back to default:"
post 8.8.8.8 '{"tenant":"__proto__"}'
echo "third session still allowed (daily cap 3):"
post 7.7.7.7 '{}'
echo "fourth session from a new ip refused:"
post 6.6.6.6 '{}'

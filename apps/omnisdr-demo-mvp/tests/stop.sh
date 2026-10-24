#!/bin/bash
# usage: [PORT=8787] stop.sh
# Stops ONLY the dev server listening on $PORT (default 8787) and its parent wrangler process.
# It never matches by process name, so another session's instance on a different port is left alone.
PORT="${PORT:-8787}"
if command -v powershell.exe >/dev/null 2>&1; then
  powershell.exe -NoProfile -Command "\$c = Get-NetTCPConnection -LocalPort $PORT -State Listen -ErrorAction SilentlyContinue; foreach (\$x in \$c) { \$p = Get-CimInstance Win32_Process -Filter \"ProcessId=\$(\$x.OwningProcess)\"; Stop-Process -Id \$x.OwningProcess,\$p.ParentProcessId -Force -ErrorAction SilentlyContinue }" >/dev/null 2>&1
elif command -v fuser >/dev/null 2>&1; then
  fuser -k "$PORT/tcp" >/dev/null 2>&1
elif command -v lsof >/dev/null 2>&1; then
  kill $(lsof -ti "tcp:$PORT" -sTCP:LISTEN) 2>/dev/null
fi
sleep 2

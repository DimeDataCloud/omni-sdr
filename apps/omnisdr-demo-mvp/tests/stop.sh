#!/bin/bash
# Stops the local dev server (port 8787). Skips this script and its parent shell so it never kills the caller.
if command -v pgrep >/dev/null 2>&1; then
  for pid in $(pgrep -f workerd) $(pgrep -f "wrangler.js dev") $(pgrep -f "wrangler dev"); do
    [ "$pid" != "$$" ] && [ "$pid" != "$PPID" ] && kill "$pid" 2>/dev/null
  done
else
  # Windows (Git Bash has no pgrep): stop whatever listens on 8787 and its parent wrangler process.
  powershell.exe -NoProfile -Command '$c = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue; foreach ($x in $c) { $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($x.OwningProcess)"; Stop-Process -Id $x.OwningProcess,$p.ParentProcessId -Force -ErrorAction SilentlyContinue }' >/dev/null 2>&1
fi
sleep 2

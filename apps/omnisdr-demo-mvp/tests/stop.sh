#!/bin/bash
# Stops the local dev server. Skips this script and its parent shell so it never kills the caller.
for pid in $(pgrep -f workerd) $(pgrep -f "wrangler.js dev") $(pgrep -f "wrangler dev"); do
  [ "$pid" != "$$" ] && [ "$pid" != "$PPID" ] && kill "$pid" 2>/dev/null
done
sleep 2

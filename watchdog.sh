#!/bin/bash
# Watchdog: restart next-server if it dies
while true; do
  if ! pgrep -f "next-server" > /dev/null 2>&1 && ! pgrep -f "server.js" > /dev/null 2>&1; then
    echo "[$(date)] Server died, restarting..."
    cd /home/z/my-project && NODE_OPTIONS="--max-old-space-size=512" HOSTNAME=0.0.0.0 PORT=3000 setsid bash -c 'bun .next/standalone/server.js > /home/z/my-project/dev.log 2>&1' < /dev/null > /dev/null 2>&1 & disown
    sleep 8
    echo "[$(date)] Server restarted, PID: $(pgrep -f server.js | head -1)"
  fi
  sleep 5
done

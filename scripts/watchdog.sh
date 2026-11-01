#!/bin/bash
# Kogu Bot 24/7 Watchdog & Self-Healing Sentinel
HEALTH_URL="http://127.0.0.1:8080/readyz"
LOG_FILE="/home/ubuntu/kogu-incidents.log"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 5 "$HEALTH_URL")

if [ "$HTTP_CODE" != "200" ]; then
    sleep 10
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 5 "$HEALTH_URL")
    if [ "$HTTP_CODE" != "200" ]; then
        NOW=$(date "+%Y-%m-%d_%H:%M:%S")
        echo "[$NOW] [ALERT] Kogu health check failed (HTTP $HTTP_CODE). Triggering auto-restart..." >> "$LOG_FILE"
        pm2 restart kogu >> "$LOG_FILE" 2>&1
        echo "[$NOW] [RECOVERED] PM2 restart command dispatched." >> "$LOG_FILE"
    fi
fi

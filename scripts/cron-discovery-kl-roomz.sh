#!/bin/bash
# KL Roomz PRD §5: Roomz.asia discovery crawl runs daily. Invoked by cron — see scripts/install-cron.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
/Users/loop/.local/bin/npx tsx --env-file-if-exists=.env src/crawlers/runDiscoveryRoomzKl.ts >> data/cron-logs/discovery-kl-roomz-cron.log 2>&1

#!/bin/bash
# PRD §7: discovery crawl runs daily. Invoked by cron — see scripts/install-cron.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
/Users/loop/.local/bin/npx tsx --env-file-if-exists=.env src/crawlers/runDiscovery.ts >> data/cron-logs/discovery-cron.log 2>&1

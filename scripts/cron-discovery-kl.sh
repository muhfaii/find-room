#!/bin/bash
# KL PRD §7: KL discovery crawl runs daily. Invoked by cron — see scripts/install-cron.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
/Users/loop/.local/bin/npx tsx --env-file-if-exists=.env src/crawlers/runDiscoveryKl.ts >> data/cron-logs/discovery-kl-cron.log 2>&1

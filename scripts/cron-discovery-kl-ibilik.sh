#!/bin/bash
# KL iBilik PRD §8: iBilik discovery crawl runs daily. Invoked by cron — see scripts/install-cron.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
/Users/loop/.local/bin/npx tsx --env-file-if-exists=.env src/crawlers/runDiscoveryIbilikKl.ts >> data/cron-logs/discovery-kl-ibilik-cron.log 2>&1

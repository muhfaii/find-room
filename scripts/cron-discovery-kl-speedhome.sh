#!/bin/bash
# KL Speedhome PRD §8: Speedhome discovery crawl runs daily. Invoked by cron — see scripts/install-cron.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
/Users/loop/.local/bin/npx tsx --env-file-if-exists=.env src/crawlers/runDiscoverySpeedhomeKl.ts >> data/cron-logs/discovery-kl-speedhome-cron.log 2>&1

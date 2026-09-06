#!/bin/bash
# KL Wetopia PRD §8: Wetopia discovery crawl runs daily. Invoked by cron — see scripts/install-cron.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
/Users/loop/.local/bin/npx tsx --env-file-if-exists=.env src/crawlers/runDiscoveryWetopiaKl.ts >> data/cron-logs/discovery-kl-wetopia-cron.log 2>&1

#!/bin/bash
# KL Wetopia PRD §8: detail refresh runs daily; internally it only processes
# today's 1/7 shard (see runDetailRefreshWetopiaKl.ts's todaysShard), so the
# weekly-sharding behavior comes from running this daily, not from cron's own
# schedule.
set -euo pipefail
cd "$(dirname "$0")/.."
/Users/loop/.local/bin/npx tsx --env-file-if-exists=.env src/crawlers/runDetailRefreshWetopiaKl.ts >> data/cron-logs/detail-refresh-kl-wetopia-cron.log 2>&1

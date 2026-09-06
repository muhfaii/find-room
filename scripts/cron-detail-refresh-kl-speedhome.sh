#!/bin/bash
# KL Speedhome PRD §8: detail refresh runs daily; internally it only processes
# today's 1/7 shard (see runDetailRefreshSpeedhomeKl.ts's todaysShard), so the
# weekly-sharding behavior comes from running this daily, not from cron's own
# schedule.
set -euo pipefail
cd "$(dirname "$0")/.."
/Users/loop/.local/bin/npx tsx --env-file-if-exists=.env src/crawlers/runDetailRefreshSpeedhomeKl.ts >> data/cron-logs/detail-refresh-kl-speedhome-cron.log 2>&1

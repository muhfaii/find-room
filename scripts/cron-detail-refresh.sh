#!/bin/bash
# PRD §7: detail refresh is invoked daily; internally it only processes today's
# 1/7 shard (see runDetailRefresh.ts's todaysShard), so the weekly-sharding
# behavior comes from running this daily, not from cron's own schedule.
set -euo pipefail
cd "$(dirname "$0")/.."
/Users/loop/.local/bin/npx tsx --env-file-if-exists=.env src/crawlers/runDetailRefresh.ts >> data/cron-logs/detail-refresh-cron.log 2>&1

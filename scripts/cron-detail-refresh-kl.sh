#!/bin/bash
# KL PRD §7: KL detail refresh runs daily; internally it only processes today's
# 1/7 shard (see runDetailRefreshKl.ts's todaysShard), so the weekly-sharding
# behavior comes from running this daily, not from cron's own schedule.
set -euo pipefail
cd "$(dirname "$0")/.."
/Users/loop/.local/bin/npx tsx --env-file-if-exists=.env src/crawlers/runDetailRefreshKl.ts >> data/cron-logs/detail-refresh-kl-cron.log 2>&1

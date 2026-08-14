import { chromium } from "playwright";
import { assertCrawlDelayRespected, fetchRobotsRules, RobotsCheckFailed } from "../lib/robots.js";
import { CsvRunWriter, csvFileName } from "../lib/csv.js";
import { KnownListingsStore } from "../lib/knownListings.js";
import { RunLogger } from "../lib/runLog.js";
import { RunProgressStore } from "../lib/runProgress.js";
import { runDetailRefreshCrawl } from "./detailRefresh.js";

const LOG_PATH = "data/logs/detail_refresh.log";

// PRD §4/§7: known listing set is sharded ~1/7 per day. Day-of-week (UTC) selects
// which shard runs today, so a cron firing daily naturally cycles through all 7.
function todaysShard(now: Date): number {
  return now.getUTCDay(); // 0=Sunday .. 6=Saturday
}

async function main() {
  const log = new RunLogger(LOG_PATH, "detail_refresh");
  const now = new Date();

  try {
    const rules = await fetchRobotsRules();
    assertCrawlDelayRespected(rules);
  } catch (err) {
    if (err instanceof RobotsCheckFailed) {
      log.abort(err.message);
      log.summarize();
      process.exit(1);
    }
    throw err;
  }

  const csvWriter = new CsvRunWriter(`data/output/${csvFileName("detail_refresh")}`);
  const store = new KnownListingsStore("data/known-listings/store.json");
  const runDate = now.toISOString().slice(0, 10);
  const progress = new RunProgressStore("data/known-listings/detail_refresh_progress.json", runDate);

  const shard = todaysShard(now);
  const listings = store.listingsForShard(shard);
  log.info(`Detail refresh shard=${shard} listing_count=${listings.length}`);

  // See runDiscovery.ts for why this uses the system Chrome channel instead of
  // Playwright's bundled Chromium (unsupported on macOS 12 / Monterey).
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await runDetailRefreshCrawl(
      page,
      listings,
      csvWriter,
      store,
      log,
      (listingId) => progress.isDone(listingId),
      (listingId) => progress.markDone(listingId),
    );
  } finally {
    await browser.close();
    log.summarize();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

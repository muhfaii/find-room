import { chromium } from "playwright";
import { assertCrawlDelayRespected, fetchRobotsRules, RobotsCheckFailed } from "../lib/robots.js";
import { KnownListingsStore } from "../lib/knownListings.js";
import { RunLogger } from "../lib/runLog.js";
import { RunProgressStore } from "../lib/runProgress.js";
import { runDetailRefreshCrawlSpeedhomeKl } from "./detailRefreshSpeedhomeKl.js";
import { ingestRowsKl, retireListingKl, resubmitDeadLetterQueueKl } from "../lib/ingestClientKl.js";

const LOG_PATH = "data/logs/detail_refresh-kl-speedhome.log";
const SPEEDHOME_BASE_URL = "https://speedhome.com";
const KNOWN_LISTINGS_PATH = "data/known-listings-kl-speedhome/store.json";

// Same weekly sharding as the other KL/Jakarta crawlers: the known listing set
// is sharded ~1/7 per day; running this daily cycles through all shards.
function todaysShard(now: Date): number {
  return now.getUTCDay(); // 0=Sunday .. 6=Saturday
}

async function main() {
  const log = new RunLogger(LOG_PATH, "detail_refresh_kl_speedhome");
  const now = new Date();

  // Replay anything that failed to reach the KL ingest worker on a previous run.
  await resubmitDeadLetterQueueKl();

  try {
    const rules = await fetchRobotsRules(SPEEDHOME_BASE_URL);
    assertCrawlDelayRespected(rules);
  } catch (err) {
    if (err instanceof RobotsCheckFailed) {
      log.abort(err.message);
      log.summarize();
      process.exit(1);
    }
    throw err;
  }

  const store = new KnownListingsStore(KNOWN_LISTINGS_PATH);
  const runDate = now.toISOString().slice(0, 10);
  const progress = new RunProgressStore(
    "data/known-listings-kl-speedhome/detail_refresh_progress.json",
    runDate,
  );

  const shard = todaysShard(now);
  const listings = store.listingsForShard(shard);
  log.info(`Detail refresh shard=${shard} listing_count=${listings.length}`);

  // See runDiscoveryKl.ts for why this uses the system Chrome channel instead
  // of Playwright's bundled Chromium (unsupported on macOS 12 / Monterey).
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await runDetailRefreshCrawlSpeedhomeKl(
      page,
      listings,
      (row) => ingestRowsKl([row]),
      retireListingKl,
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

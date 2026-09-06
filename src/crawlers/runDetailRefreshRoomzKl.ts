import { chromium } from "playwright";
import { assertCrawlDelayRespected, fetchRobotsRules, RobotsCheckFailed } from "../lib/robots.js";
import { KnownListingsStore } from "../lib/knownListings.js";
import { RunLogger } from "../lib/runLog.js";
import { RunProgressStore } from "../lib/runProgress.js";
import { runDetailRefreshCrawlRoomzKl } from "./detailRefreshRoomzKl.js";
import { ingestRowsKl, retireListingKl, resubmitDeadLetterQueueKl } from "../lib/ingestClientKl.js";

const LOG_PATH = "data/logs/detail_refresh-kl-roomz.log";
const ROOMZ_BASE_URL = "https://my.roomz.asia";

function todaysShard(now: Date): number {
  return now.getUTCDay();
}

async function main() {
  const log = new RunLogger(LOG_PATH, "detail_refresh_kl_roomz");
  const now = new Date();

  await resubmitDeadLetterQueueKl();

  try {
    const rules = await fetchRobotsRules(ROOMZ_BASE_URL);
    assertCrawlDelayRespected(rules);
  } catch (err) {
    if (err instanceof RobotsCheckFailed) {
      log.abort(err.message);
      log.summarize();
      process.exit(1);
    }
    throw err;
  }

  const store = new KnownListingsStore("data/known-listings-kl-roomz/store.json");
  const runDate = now.toISOString().slice(0, 10);
  const progress = new RunProgressStore("data/known-listings-kl-roomz/detail_refresh_progress.json", runDate);

  const shard = todaysShard(now);
  const listings = store.listingsForShard(shard);
  log.info(`Detail refresh shard=${shard} listing_count=${listings.length}`);

  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await runDetailRefreshCrawlRoomzKl(
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

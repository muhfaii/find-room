import { chromium } from "playwright";
import { assertCrawlDelayRespected, fetchRobotsRules, RobotsCheckFailed } from "../lib/robots.js";
import { KnownListingsStore } from "../lib/knownListings.js";
import { RunLogger } from "../lib/runLog.js";
import { RunProgressStore } from "../lib/runProgress.js";
import { runDetailRefreshCrawlIbilikKl } from "./detailRefreshIbilikKl.js";
import { ingestRowsKl, retireListingKl, resubmitDeadLetterQueueKl } from "../lib/ingestClientKl.js";

const LOG_PATH = "data/logs/detail_refresh-kl-ibilik.log";
const IBILIK_BASE_URL = "https://www.ibilik.com";
const KNOWN_LISTINGS_PATH = "data/known-listings-kl-ibilik/store.json";

function todaysShard(now: Date): number {
  return now.getUTCDay();
}

async function main() {
  const log = new RunLogger(LOG_PATH, "detail_refresh_kl_ibilik");
  const now = new Date();

  await resubmitDeadLetterQueueKl();

  // See runDiscoveryIbilikKl.ts for why a confirmed 404 on /robots.txt here
  // is treated as "no rules to enforce" rather than an abort.
  try {
    const rules = await fetchRobotsRules(IBILIK_BASE_URL);
    assertCrawlDelayRespected(rules);
  } catch (err) {
    if (err instanceof RobotsCheckFailed) {
      if (/HTTP 404/.test(err.message)) {
        log.info("No robots.txt found on ibilik.com (confirmed 404) — proceeding with default politeness.");
      } else {
        log.abort(err.message);
        log.summarize();
        process.exit(1);
      }
    } else {
      throw err;
    }
  }

  const store = new KnownListingsStore(KNOWN_LISTINGS_PATH);
  const runDate = now.toISOString().slice(0, 10);
  const progress = new RunProgressStore("data/known-listings-kl-ibilik/detail_refresh_progress.json", runDate);

  const shard = todaysShard(now);
  const listings = store.listingsForShard(shard);
  log.info(`Detail refresh shard=${shard} listing_count=${listings.length}`);

  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await runDetailRefreshCrawlIbilikKl(
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

import { chromium } from "playwright";
import { assertCrawlDelayRespected, assertPathAllowed, fetchRobotsRules, RobotsCheckFailed } from "../lib/robots.js";
import { KnownListingsStore } from "../lib/knownListings.js";
import { RunLogger } from "../lib/runLog.js";
import { runDiscoveryCrawlRoomzKl } from "./discoveryRoomzKl.js";
import { ingestRowsKl, resubmitDeadLetterQueueKl } from "../lib/ingestClientKl.js";
import { ROOMZ_SEED_URL } from "../config/klRoomz.js";

const LOG_PATH = "data/logs/discovery-kl-roomz.log";
const ROOMZ_BASE_URL = "https://my.roomz.asia";

async function main() {
  const log = new RunLogger(LOG_PATH, "discovery_kl_roomz");

  await resubmitDeadLetterQueueKl();

  // KL Roomz PRD §4: robots.txt is fully permissive — `Allow: /`, no path
  // restrictions, no named-bot blocks, no Crawl-delay (confirmed 2026-09-06).
  try {
    const rules = await fetchRobotsRules(ROOMZ_BASE_URL);
    assertPathAllowed(rules, new URL(ROOMZ_SEED_URL).pathname);
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

  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await runDiscoveryCrawlRoomzKl(page, (row) => ingestRowsKl([row]), store, log);
  } finally {
    await browser.close();
    log.summarize();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

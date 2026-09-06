import { chromium } from "playwright";
import { assertCrawlDelayRespected, assertPathAllowed, fetchRobotsRules, RobotsCheckFailed } from "../lib/robots.js";
import { KnownListingsStore } from "../lib/knownListings.js";
import { RunLogger } from "../lib/runLog.js";
import { runDiscoveryCrawlSpeedhomeKl } from "./discoverySpeedhomeKl.js";
import { ingestRowsKl, resubmitDeadLetterQueueKl } from "../lib/ingestClientKl.js";
import { KL_SPEEDHOME_SEEDS } from "../config/klSpeedhome.js";

const LOG_PATH = "data/logs/discovery-kl-speedhome.log";
const SPEEDHOME_BASE_URL = "https://speedhome.com";

// KnownListingsStore is per-source, not shared with Mudah.my's
// data/known-listings-kl/ — same "parallel structure per source" reasoning as
// everything else here (see src/config/klangValley.ts's header comment):
// Speedhome's detail-refresh only knows how to extract Speedhome records, so
// its known-listings set must not get mixed with Mudah.my's.
const KNOWN_LISTINGS_PATH = "data/known-listings-kl-speedhome/store.json";

async function main() {
  const log = new RunLogger(LOG_PATH, "discovery_kl_speedhome");

  // Replay anything that failed to reach the KL ingest worker on a previous run.
  await resubmitDeadLetterQueueKl();

  // KL Speedhome PRD §3: automated pre-run compliance check — abort before any
  // requests if robots.txt now disallows a target path or requires a
  // stricter crawl-delay. Verified 2026-08-28: Allow: / for "*", with only
  // /dashboard/, /reels/, and literal-"&" query strings disallowed — nothing
  // overlaps with /rent/{city}/room or /details/{slug}.
  try {
    const rules = await fetchRobotsRules(SPEEDHOME_BASE_URL);
    for (const seed of KL_SPEEDHOME_SEEDS) {
      assertPathAllowed(rules, new URL(seed.seedUrl).pathname);
    }
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

  // Same system-Chrome-channel reasoning as the other KL crawlers (see
  // runDiscoveryKl.ts) — Playwright's bundled Chromium no longer ships for
  // macOS 12 (Monterey).
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext(); // single context, no concurrency
  const page = await context.newPage();

  try {
    await runDiscoveryCrawlSpeedhomeKl(page, (row) => ingestRowsKl([row]), store, log);
  } finally {
    await browser.close();
    log.summarize();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

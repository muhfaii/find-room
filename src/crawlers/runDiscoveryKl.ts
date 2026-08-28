import { chromium } from "playwright";
import { assertCrawlDelayRespected, assertPathAllowed, fetchRobotsRules, RobotsCheckFailed } from "../lib/robots.js";
import { KnownListingsStore } from "../lib/knownListings.js";
import { RunLogger } from "../lib/runLog.js";
import { runDiscoveryCrawlKl } from "./discoveryKl.js";
import { ingestRowsKl, resubmitDeadLetterQueueKl } from "../lib/ingestClientKl.js";
import { KL_MUDAH_SEEDS } from "../config/klMudah.js";

const LOG_PATH = "data/logs/discovery-kl.log";
const MUDAH_BASE_URL = "https://www.mudah.my";

async function main() {
  const log = new RunLogger(LOG_PATH, "discovery_kl");

  // Replay anything that failed to reach the KL ingest worker on a previous run.
  await resubmitDeadLetterQueueKl();

  // KL PRD §3: automated pre-run compliance check — abort before any requests
  // if robots.txt now disallows a target path or requires a stricter
  // crawl-delay. fetchRobotsRules is parameterized by base URL so the same
  // shared checker runs against mudah.my (verified 2026-08-28: only ad-tracking
  // params and a few non-search paths are disallowed; nothing overlaps with
  // /rooms-for-rent, city pages, or {slug}-{id}.htm detail pages).
  try {
    const rules = await fetchRobotsRules(MUDAH_BASE_URL);
    for (const seed of KL_MUDAH_SEEDS) {
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

  const store = new KnownListingsStore("data/known-listings-kl/store.json");

  // Stock Playwright/Chromium UA — not customized or self-identifying (KL PRD
  // §3 posture, same as Jakarta). Uses the system-installed Google Chrome
  // (channel: "chrome") rather than Playwright's bundled Chromium build, which
  // no longer ships for macOS 12 (Monterey). Requires Google Chrome.app.
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext(); // single context, no concurrency
  const page = await context.newPage();

  try {
    await runDiscoveryCrawlKl(page, (row) => ingestRowsKl([row]), store, log);
  } finally {
    await browser.close();
    log.summarize();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

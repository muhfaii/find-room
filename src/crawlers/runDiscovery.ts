import { chromium } from "playwright";
import { assertCrawlDelayRespected, assertPathAllowed, fetchRobotsRules, RobotsCheckFailed } from "../lib/robots.js";
import { KnownListingsStore } from "../lib/knownListings.js";
import { RunLogger } from "../lib/runLog.js";
import { DailyClickBudget } from "../lib/clickBudget.js";
import { runDiscoveryCrawl } from "./discovery.js";
import { ingestRows, resubmitDeadLetterQueue } from "../lib/ingestClient.js";
import { JAKARTA_SEEDS } from "../config/jakarta.js";

const LOG_PATH = "data/logs/discovery.log";

async function main() {
  const log = new RunLogger(LOG_PATH, "discovery");
  const runDate = new Date().toISOString().slice(0, 10);
  const clickBudget = new DailyClickBudget("data/known-listings/click_budget.json", runDate);

  // Replay anything that failed to reach the ingest worker on a previous run.
  await resubmitDeadLetterQueue();

  // PRD §3: automated pre-run compliance check — abort before any requests if
  // robots.txt now disallows a target path or requires a stricter crawl-delay.
  try {
    const rules = await fetchRobotsRules();
    for (const seed of JAKARTA_SEEDS) {
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

  const store = new KnownListingsStore("data/known-listings/store.json");

  // PRD §4: stock Playwright/Chromium UA — not customized or self-identifying.
  // Uses the system-installed Google Chrome (channel: "chrome") rather than
  // Playwright's bundled Chromium build, since the bundled build no longer ships
  // for macOS 12 (Monterey). Requires Google Chrome.app already installed.
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext(); // single context, no concurrency
  const page = await context.newPage();

  try {
    await runDiscoveryCrawl(page, (row) => ingestRows([row]), store, log, clickBudget);
  } finally {
    await browser.close();
    log.summarize();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

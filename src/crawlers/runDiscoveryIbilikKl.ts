import { chromium } from "playwright";
import { assertCrawlDelayRespected, fetchRobotsRules, RobotsCheckFailed } from "../lib/robots.js";
import { KnownListingsStore } from "../lib/knownListings.js";
import { RunLogger } from "../lib/runLog.js";
import { runDiscoveryCrawlIbilikKl } from "./discoveryIbilikKl.js";
import { ingestRowsKl, resubmitDeadLetterQueueKl } from "../lib/ingestClientKl.js";

const LOG_PATH = "data/logs/discovery-kl-ibilik.log";
const IBILIK_BASE_URL = "https://www.ibilik.com";
const KNOWN_LISTINGS_PATH = "data/known-listings-kl-ibilik/store.json";

async function main() {
  const log = new RunLogger(LOG_PATH, "discovery_kl_ibilik");

  await resubmitDeadLetterQueueKl();

  // KL iBilik PRD §3: no robots.txt exists on this site at all — confirmed
  // both via a bare fetch and a real browser request (genuine 404, not a
  // bot-detection artifact). Absence of a robots.txt is conventionally
  // unrestricted crawling, not a compliance failure — fetchRobotsRules()
  // treats ANY non-ok HTTP status as an abort-worthy failure (correct for
  // every other KL source, where a 404 there would mean something actually
  // broke), so a 404 specifically is caught and treated as "no rules to
  // enforce" here rather than propagated as an abort. Any other failure mode
  // (network error, unexpected 5xx, etc.) still aborts the run as normal.
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

  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await runDiscoveryCrawlIbilikKl(page, (row) => ingestRowsKl([row]), store, log);
  } finally {
    await browser.close();
    log.summarize();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

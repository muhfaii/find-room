import { chromium } from "playwright";
import { assertCrawlDelayRespected, fetchRobotsRules, RobotsCheckFailed } from "../lib/robots.js";
import { KnownListingsStore } from "../lib/knownListings.js";
import { RunLogger } from "../lib/runLog.js";
import { runDiscoveryCrawlWetopiaKl } from "./discoveryWetopiaKl.js";
import { ingestRowsKl, resubmitDeadLetterQueueKl } from "../lib/ingestClientKl.js";

const LOG_PATH = "data/logs/discovery-kl-wetopia.log";
const WETOPIA_BASE_URL = "https://wetopia.my";
const KNOWN_LISTINGS_PATH = "data/known-listings-kl-wetopia/store.json";

async function main() {
  const log = new RunLogger(LOG_PATH, "discovery_kl_wetopia");

  await resubmitDeadLetterQueueKl();

  // KL Wetopia PRD §5: Allow: / for "*", only /wp-admin/ disallowed — neither
  // the REST endpoint nor /listing/{slug}/ pages are affected. No path-level
  // assertPathAllowed check here (unlike the seed-URL sources) since
  // discovery's URL set is dynamic (whatever the REST API returns), not fixed
  // — the crawl-delay check is what actually matters pre-run.
  try {
    const rules = await fetchRobotsRules(WETOPIA_BASE_URL);
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

  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await runDiscoveryCrawlWetopiaKl(page, (row) => ingestRowsKl([row]), store, log);
  } finally {
    await browser.close();
    log.summarize();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

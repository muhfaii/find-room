import type { Page } from "playwright";
import { MAX_PAGES, ROOMZ_SEED_URL } from "../config/klRoomz.js";
import { isInKlangValleyScope } from "../config/klangValley.js";
import { politeWait } from "../config/politeness.js";
import { KnownListingsStore } from "../lib/knownListings.js";
import { RunLogger } from "../lib/runLog.js";
import { computeCardSignature } from "../lib/signature.js";
import { buildLightweightRoomzRow, extractRoomzListPage } from "./roomzExtract.js";
import type { KlRoomzListingRow } from "../types/klRoomzListing.js";

// KL Roomz PRD §2: one global seed (the whole room category, nationwide),
// paginated — not per-city seed URLs, since location pages are hard-capped
// and don't cover all 7 target cities. Every card's own address text is
// scope-guarded, the same "search broad, scope-guard precisely" pattern used
// wherever a source's seed can't be scoped narrowly (e.g. Mudah.my's
// cross-promoted out-of-region listings).
export async function runDiscoveryCrawlRoomzKl(
  page: Page,
  ingest: (row: KlRoomzListingRow) => Promise<void>,
  store: KnownListingsStore,
  log: RunLogger,
): Promise<void> {
  let pageNum = 1;

  while (pageNum <= MAX_PAGES) {
    const pageUrl = pageNum === 1 ? ROOMZ_SEED_URL : `${ROOMZ_SEED_URL}?page=${pageNum}`;
    try {
      await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
      const { cards, hasNextPage } = await extractRoomzListPage(page);
      log.info(`Roomz discovery page=${pageNum} cards=${cards.length} hasNextPage=${hasNextPage}`);

      if (cards.length === 0) break;

      const now = new Date().toISOString();
      for (const card of cards) {
        const row = buildLightweightRoomzRow(card, now, "discovery");

        if (!isInKlangValleyScope(row.address_raw)) {
          log.skip(row.listing_id, row.url, `scope_guard address="${row.address_raw}"`);
          continue;
        }

        await ingest(row);
        const signature = computeCardSignature(row.address_raw ?? "", null, row.title, row.price_raw_text);
        store.upsertFromDiscoveryClick(row.listing_id, row.url, row.address_raw ?? "", signature, now);
        log.success(row.listing_id, row.url);
      }

      if (!hasNextPage) break;
    } catch (err) {
      // A page-level failure must not abort the whole run — log it and move
      // to the next page (same KL PRD §8 resilience philosophy as every
      // other source).
      const reason = err instanceof Error ? err.message : String(err);
      log.failure("(page)", pageUrl, reason);
    }

    pageNum += 1;
    await politeWait();
  }
}

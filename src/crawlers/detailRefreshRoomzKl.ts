import type { Page } from "playwright";
import { isInKlangValleyScope } from "../config/klangValley.js";
import { politeWait } from "../config/politeness.js";
import { KnownListingsStore, type KnownListing } from "../lib/knownListings.js";
import { RunLogger } from "../lib/runLog.js";
import { buildFullRoomzRow, extractRoomzDetailPage } from "./roomzExtract.js";
import type { KlRoomzListingRow } from "../types/klRoomzListing.js";

export async function runDetailRefreshCrawlRoomzKl(
  page: Page,
  listings: KnownListing[],
  ingest: (row: KlRoomzListingRow) => Promise<void>,
  retire: (listingId: string) => Promise<void>,
  store: KnownListingsStore,
  log: RunLogger,
  isAlreadyDoneThisRun: (listingId: string) => boolean,
  markDoneThisRun: (listingId: string) => void,
): Promise<void> {
  for (const listing of listings) {
    if (isAlreadyDoneThisRun(listing.listingId)) continue;

    const now = new Date().toISOString();
    try {
      await page.goto(listing.url, { waitUntil: "domcontentloaded" });
      const detail = await extractRoomzDetailPage(page);
      const row = buildFullRoomzRow(detail, listing.listingId, listing.url, now, "detail_refresh");

      if (!isInKlangValleyScope(row.address_raw)) {
        log.skip(listing.listingId, listing.url, `scope_guard address="${row.address_raw}"`);
        markDoneThisRun(listing.listingId);
        await politeWait();
        continue;
      }

      await ingest(row);
      store.recordRefreshSuccess(listing.listingId, now);
      log.success(listing.listingId, listing.url);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const retired = store.recordRefreshFailure(listing.listingId, now, reason);
      log.failure(listing.listingId, listing.url, retired ? `${reason} (retired)` : reason);
      if (retired) {
        await retire(listing.listingId);
      }
    }

    markDoneThisRun(listing.listingId);
    await politeWait();
  }
}

import type { Page } from "playwright";
import { isInKlangValleyScope } from "../config/klangValley.js";
import { politeWait } from "../config/politeness.js";
import { KnownListingsStore, type KnownListing } from "../lib/knownListings.js";
import { RunLogger } from "../lib/runLog.js";
import { buildWetopiaRows, extractWetopiaPropertyPage } from "./wetopiaExtract.js";
import type { WetopiaListingRow } from "../types/klWetopiaListing.js";

// ADR-0007: multiple listing_ids legitimately share one property URL. A day's
// shard can contain several rooms from the same property — re-visiting that
// URL once per room would be wasteful and impolite for no benefit (the page
// gives every room's data in one load). Group by URL first, visit each
// property once, then match each known listing back to its room by the index
// encoded in its listing_id (`wetopia-{slug}-room-{n}`).
function groupByUrl(listings: KnownListing[]): Map<string, KnownListing[]> {
  const groups = new Map<string, KnownListing[]>();
  for (const listing of listings) {
    const group = groups.get(listing.url);
    if (group) group.push(listing);
    else groups.set(listing.url, [listing]);
  }
  return groups;
}

function extractRoomIndex(listingId: string): number | null {
  const m = listingId.match(/-room-(\d+)$/);
  return m ? Number(m[1]) : null;
}

export async function runDetailRefreshCrawlWetopiaKl(
  page: Page,
  listings: KnownListing[],
  ingest: (row: WetopiaListingRow) => Promise<void>,
  retire: (listingId: string) => Promise<void>,
  store: KnownListingsStore,
  log: RunLogger,
  isAlreadyDoneThisRun: (listingId: string) => boolean,
  markDoneThisRun: (listingId: string) => void,
): Promise<void> {
  const pending = listings.filter((l) => !isAlreadyDoneThisRun(l.listingId));
  const groups = groupByUrl(pending);

  for (const [url, groupListings] of groups) {
    const now = new Date().toISOString();
    let rows: WetopiaListingRow[] = [];
    // Kept separate from pageFailed on purpose: a scope-guard miss is not a
    // failure, the same distinction every other KL source's detail-refresh
    // makes (see detailRefreshKl.ts / detailRefreshSpeedhomeKl.ts — both
    // `log.skip` and `continue` on a scope miss, never touching
    // consecutiveFailures). Folding it into pageFailed would silently retire
    // an out-of-scope-but-otherwise-fine listing for the wrong reason.
    let pageFailed: string | null = null;
    let scopeGuardMiss: string | null = null;

    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      const property = await extractWetopiaPropertyPage(page);
      // The property slug is recoverable from any of this group's listing_ids
      // (wetopia-{slug}-room-{n}) rather than re-deriving it from the URL.
      const slugMatch = groupListings[0].listingId.match(/^wetopia-(.+)-room-\d+$/);
      const slug = slugMatch ? slugMatch[1] : url;
      rows = buildWetopiaRows(slug, url, property, now, "detail_refresh");

      if (!isInKlangValleyScope(property.addressRaw)) {
        scopeGuardMiss = `scope_guard address="${property.addressRaw}"`;
      }
    } catch (err) {
      pageFailed = err instanceof Error ? err.message : String(err);
    }

    const rowsByIndex = new Map(
      rows.map((row) => [extractRoomIndex(row.listing_id), row] as const),
    );

    for (const listing of groupListings) {
      if (scopeGuardMiss) {
        log.skip(listing.listingId, listing.url, scopeGuardMiss);
        markDoneThisRun(listing.listingId);
        continue;
      }

      const index = extractRoomIndex(listing.listingId);
      const row = index !== null ? rowsByIndex.get(index) : undefined;

      if (pageFailed || !row) {
        // KL Wetopia PRD §8 / ADR-0007: a room's index no longer appearing on
        // its property page (the property now has fewer rooms, or the page
        // itself failed to load at all) is treated as a refresh failure — the
        // same RETIREMENT_FAILURE_THRESHOLD mechanism every other KL source
        // uses, reused here rather than inventing a separate "room vanished"
        // concept, since the practical handling (retire after N consecutive
        // misses, don't retire on the first one) is the same either way. This
        // is deliberately distinct from the scope-guard case above.
        const reason = pageFailed ?? "room_index_not_found_on_property_page";
        const retired = store.recordRefreshFailure(listing.listingId, now, reason);
        log.failure(listing.listingId, listing.url, retired ? `${reason} (retired)` : reason);
        if (retired) await retire(listing.listingId);
      } else {
        await ingest(row);
        store.recordRefreshSuccess(listing.listingId, now);
        log.success(listing.listingId, listing.url);
      }

      markDoneThisRun(listing.listingId);
    }

    await politeWait();
  }
}

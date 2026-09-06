import type { Page } from "playwright";
import { isInKlangValleyScope } from "../config/klangValley.js";
import { politeWait } from "../config/politeness.js";
import { KnownListingsStore, type KnownListing } from "../lib/knownListings.js";
import { RunLogger } from "../lib/runLog.js";
import { extractSpeedhomeFields, type SpeedhomeRawRecord } from "./speedhomeExtract.js";
import type { SpeedhomeListingRow } from "../types/klSpeedhomeListing.js";

// KL Speedhome PRD §4: the detail page (/details/{slug}) embeds the identical
// record shape as a search card, under
// window.__NEXT_DATA__.props.pageProps.propertyInfo — confirmed live
// 2026-08-28 by comparing field values for the same listing id against its
// search-card record (every field matched exactly). So detail-refresh reuses
// the same extractSpeedhomeFields() discovery does; the only difference is
// where the raw record comes from on the page.
async function waitForDetailState(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const raw = document.getElementById("__NEXT_DATA__")?.textContent;
      if (!raw) return false;
      try {
        const data = JSON.parse(raw);
        return Boolean(data?.props?.pageProps?.propertyInfo?.id);
      } catch {
        return false;
      }
    },
    { timeout: 15000 },
  );
}

async function extractPropertyInfo(page: Page): Promise<SpeedhomeRawRecord | null> {
  return page.evaluate<SpeedhomeRawRecord | null>(() => {
    const raw = document.getElementById("__NEXT_DATA__")?.textContent;
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data?.props?.pageProps?.propertyInfo ?? null;
  });
}

function scopeLocationText(row: SpeedhomeListingRow): string | null {
  return row.city_raw ?? row.address_raw;
}

export async function runDetailRefreshCrawlSpeedhomeKl(
  page: Page,
  listings: KnownListing[],
  ingest: (row: SpeedhomeListingRow) => Promise<void>,
  retire: (listingId: string) => Promise<void>,
  store: KnownListingsStore,
  log: RunLogger,
  isAlreadyDoneThisRun: (listingId: string) => boolean,
  markDoneThisRun: (listingId: string) => void,
): Promise<void> {
  for (const listing of listings) {
    // KL Speedhome PRD §8 resumability: skip listings already completed
    // earlier in this same run.
    if (isAlreadyDoneThisRun(listing.listingId)) continue;

    const now = new Date().toISOString();
    try {
      // domcontentloaded, not networkidle — same reasoning as the other KL
      // crawlers (KL Speedhome PRD §8).
      await page.goto(listing.url, { waitUntil: "domcontentloaded" });
      await waitForDetailState(page);
      const record = await extractPropertyInfo(page);

      if (!record) {
        throw new Error("propertyInfo not found — page structure may have changed");
      }

      const row = extractSpeedhomeFields(record, now, "detail_refresh");

      // Scope guard applies on refresh too — a listing's city could
      // theoretically change, or a listing that leaked through the wrong
      // seed page could still be sitting in the known-listings store.
      const locationText = scopeLocationText(row);
      if (!isInKlangValleyScope(locationText)) {
        log.skip(listing.listingId, listing.url, `scope_guard location="${locationText}"`);
        markDoneThisRun(listing.listingId);
        await politeWait();
        continue;
      }
      if (record.type !== "ROOM") {
        log.skip(listing.listingId, listing.url, `wrong_type type="${record.type}"`);
        markDoneThisRun(listing.listingId);
        await politeWait();
        continue;
      }

      await ingest(row);
      store.recordRefreshSuccess(listing.listingId, now);
      log.success(listing.listingId, listing.url);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      // KL Speedhome PRD §8: per-listing failures are logged and skipped,
      // never abort the run; RETIREMENT_FAILURE_THRESHOLD consecutive
      // failures auto-retire, same as the other KL crawlers.
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

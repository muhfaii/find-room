import type { Page } from "playwright";
import { isInKlangValleyScope } from "../config/klangValley.js";
import { politeWait } from "../config/politeness.js";
import { KnownListingsStore, type KnownListing } from "../lib/knownListings.js";
import { RunLogger } from "../lib/runLog.js";
import { buildFullIbilikRow, extractIbilikListingDetail, ibilikScopeText } from "./ibilikExtract.js";
import type { KlIbilikListingRow } from "../types/klIbilikListing.js";

export async function runDetailRefreshCrawlIbilikKl(
  page: Page,
  listings: KnownListing[],
  ingest: (row: KlIbilikListingRow) => Promise<void>,
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
      const detail = await extractIbilikListingDetail(page);

      if (!detail) {
        throw new Error("listing loaderData not found — page structure may have changed");
      }

      // KL iBilik PRD §1: re-verify type === "ROOM" per listing rather than
      // trusting the seed alone — the platform also has ELDERLY_CARE and
      // other categories. Cards carry no `type` field (KL iBilik PRD §4), so
      // a wrong-category listing is unavoidably ingested once at discovery
      // time — actively retire it here rather than merely skipping, so it
      // doesn't sit active/searchable in D1 indefinitely once caught (a plain
      // `log.skip` would leave the discovery-time row active forever, since
      // nothing else in this pipeline would ever revisit it to correct that).
      if (detail.type !== "ROOM") {
        log.skip(listing.listingId, listing.url, `wrong_type type="${detail.type}"`);
        await retire(listing.listingId);
        markDoneThisRun(listing.listingId);
        await politeWait();
        continue;
      }

      const row = buildFullIbilikRow(detail, now, "detail_refresh");

      // Detail-page data uses the authoritative state/city taxonomy (KL
      // iBilik PRD §3) — the strict scope check always applies here, unlike
      // discovery's Kuala-Lumpur-seed exception.
      const scopeText = ibilikScopeText(row);
      if (!isInKlangValleyScope(scopeText)) {
        log.skip(listing.listingId, listing.url, `scope_guard location="${scopeText}"`);
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

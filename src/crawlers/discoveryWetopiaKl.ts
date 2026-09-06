import type { Page } from "playwright";
import { fetchWetopiaListingRefs, isKlangValleyState } from "../config/klWetopia.js";
import { isInKlangValleyScope } from "../config/klangValley.js";
import { politeWait } from "../config/politeness.js";
import { KnownListingsStore } from "../lib/knownListings.js";
import { RunLogger } from "../lib/runLog.js";
import { computeCardSignature } from "../lib/signature.js";
import { buildWetopiaRows, extractWetopiaPropertyPage } from "./wetopiaExtract.js";
import type { WetopiaListingRow } from "../types/klWetopiaListing.js";

// KL Wetopia PRD §2: discovery is a flat REST API enumeration of the whole
// company catalog (20 properties total, confirmed live 2026-08-28) — no
// per-city seed URLs, no pagination. State-level filtering (KL/Selangor) is
// the coarse pass; isInKlangValleyScope against the scraped address text is
// the real per-listing scope guard, same doctrine as every other KL source.
export async function runDiscoveryCrawlWetopiaKl(
  page: Page,
  ingest: (row: WetopiaListingRow) => Promise<void>,
  store: KnownListingsStore,
  log: RunLogger,
): Promise<void> {
  const refs = await fetchWetopiaListingRefs();
  const candidates = refs.filter((r) => isKlangValleyState(r.state));
  log.info(`Wetopia: ${refs.length} properties company-wide, ${candidates.length} in KL/Selangor`);

  for (const ref of candidates) {
    try {
      await page.goto(ref.link, { waitUntil: "domcontentloaded" });
      const property = await extractWetopiaPropertyPage(page);
      const now = new Date().toISOString();
      const rows = buildWetopiaRows(ref.slug, ref.link, property, now, "discovery");

      if (rows.length === 0) {
        log.skip(ref.slug, ref.link, "no_rooms_found_on_page");
        await politeWait();
        continue;
      }

      // Scope guard applies per-property (all rooms on one page share the
      // same address) — KL Wetopia PRD §3: address text is the only location
      // signal this source offers.
      if (!isInKlangValleyScope(property.addressRaw)) {
        log.skip(ref.slug, ref.link, `scope_guard address="${property.addressRaw}"`);
        await politeWait();
        continue;
      }

      for (const row of rows) {
        await ingest(row);
        const signature = computeCardSignature(row.city_raw ?? "", row.area_raw, row.title, row.price_amount_raw);
        store.upsertFromDiscoveryClick(row.listing_id, row.url, row.city_raw ?? "", signature, now);
        log.success(row.listing_id, row.url);
      }
    } catch (err) {
      // A page-level failure must not abort the whole run — log it and move
      // to the next property (same KL PRD §8 resilience philosophy as every
      // other source).
      const reason = err instanceof Error ? err.message : String(err);
      log.failure(ref.slug, ref.link, reason);
    }
    await politeWait();
  }
}

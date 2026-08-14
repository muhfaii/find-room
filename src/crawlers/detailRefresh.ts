import type { Page } from "playwright";
import { isInJakartaScope } from "../config/jakarta.js";
import { politeWait } from "../config/politeness.js";
import { CsvRunWriter } from "../lib/csv.js";
import { KnownListingsStore, type KnownListing } from "../lib/knownListings.js";
import { RunLogger } from "../lib/runLog.js";
import type { ListingRow } from "../types/listing.js";

export interface DetailFields {
  title: string;
  priceRawText: string;
  priceInclusionsRaw: string | null;
  cityRaw: string;
  areaRaw: string | null;
  addressRaw: string | null;
  latitude: number | null;
  longitude: number | null;
  genderRestrictionRaw: string | null;
  roomTypeRaw: string | null;
  facilitiesRaw: string[] | null;
  descriptionRaw: string | null;
  availabilityStatusRaw: string | null;
  rating: number | null;
  reviewCount: number | null;
  imageUrls: string[] | null;
}

// Confirmed against a live listing page on 2026-08-02 (data/dom-snapshots/detail-real.html).
// Mamikos inlines the full listing record as a plain (non-encrypted) JS global —
// `var detail = {...}` in an ordinary <script> tag, sent in the initial HTML to
// every visitor. This is a different mechanism from the search-results API's
// encrypted `rooms` payload (which we deliberately do NOT touch, per §3
// compliance — see PRD notes on the encrypted API). Reading `window.detail` here
// is equivalent to reading the page's own rendered text, just structured instead
// of scraped via CSS selectors, so field values below match what a visitor sees.
//
// price_raw_text is still read from the rendered DOM (not window.detail) to
// preserve the exact display formatting ("Rp4.000.000 /bulan") rather than
// reconstructing it from separate numeric fields.
//
// TODO still open: gender_restriction_raw and availability_status_raw have no
// confirmed literal on-page text source yet (window.detail only exposes numeric
// codes for these — e.g. gender: 0 — which would require an inferred mapping the
// PRD forbids doing in the scraper). Left null until the visible badge/label
// selectors are found on a live page.
export async function extractDetailFields(page: Page): Promise<DetailFields> {
  // window.detail can exist before the price DOM node has finished rendering
  // (observed in testing: detail fields populated but .rc-price__text still
  // empty) — wait for both explicitly rather than relying on networkidle alone.
  await page.waitForFunction(() => Boolean((window as unknown as { detail?: unknown }).detail), {
    timeout: 15000,
  });
  await page.waitForSelector(".rc-price__text", { timeout: 15000 }).catch(() => {});

  return page.evaluate(() => {
    const detail = (window as unknown as { detail?: Record<string, unknown> }).detail;
    if (!detail) {
      throw new Error("window.detail not found — page structure may have changed");
    }

    const priceRawText =
      (document.querySelector(".rc-price__text")?.textContent?.trim() ?? "") +
      (document.querySelector(".rc-price__type")?.textContent?.trim()
        ? " " + document.querySelector(".rc-price__type")!.textContent!.trim()
        : "");

    const facRoom = Array.isArray(detail.fac_room) ? (detail.fac_room as string[]) : [];
    const facShare = Array.isArray(detail.fac_share) ? (detail.fac_share as string[]) : [];
    const facBath = Array.isArray(detail.fac_bath) ? (detail.fac_bath as string[]) : [];
    const facilities = [...facRoom, ...facShare, ...facBath];

    const photoUrl = detail.photo_url as { large?: string } | undefined;
    const imageUrls = photoUrl?.large ? [photoUrl.large] : [];

    return {
      title: (detail.room_title as string) ?? "",
      priceRawText,
      priceInclusionsRaw: null, // TODO: confirm selector for "+ listrik" style inclusions text
      cityRaw: (detail.area_city as string) ?? "",
      areaRaw: (detail.area_subdistrict as string) || null,
      addressRaw: (detail.address as string) || null,
      latitude: typeof detail.latitude === "number" ? detail.latitude : null,
      longitude: typeof detail.longitude === "number" ? detail.longitude : null,
      genderRestrictionRaw: null, // TODO: window.detail only has a numeric `gender` code
      roomTypeRaw: (detail.kost_type as string) || null,
      facilitiesRaw: facilities.length ? facilities : null,
      descriptionRaw: (detail.description as string) || null,
      availabilityStatusRaw: null, // TODO: window.detail only has numeric `status`/`available_room`
      rating: typeof detail.rating === "number" ? detail.rating : null,
      reviewCount: typeof detail.review_count === "number" ? detail.review_count : null,
      imageUrls: imageUrls.length ? imageUrls : null,
    };
  });
}

export async function runDetailRefreshCrawl(
  page: Page,
  listings: KnownListing[],
  csvWriter: CsvRunWriter,
  store: KnownListingsStore,
  log: RunLogger,
  isAlreadyDoneThisRun: (listingId: string) => boolean,
  markDoneThisRun: (listingId: string) => void,
): Promise<void> {
  for (const listing of listings) {
    // PRD §9 resumability: skip listings already completed earlier in this same run.
    if (isAlreadyDoneThisRun(listing.listingId)) continue;

    const now = new Date().toISOString();
    try {
      // domcontentloaded, not networkidle — this site has continuous background
      // ad/analytics network activity that can prevent networkidle from ever
      // firing (confirmed in testing: 30s+ timeouts). extractDetailFields has
      // its own explicit waits for the fields that actually matter.
      await page.goto(listing.url, { waitUntil: "domcontentloaded" });
      const fields = await extractDetailFields(page);

      // Scope guard applies on refresh too — a listing could theoretically be
      // re-categorized out of Jakarta since it was first discovered.
      if (!isInJakartaScope(fields.cityRaw)) {
        log.skip(listing.listingId, listing.url, `scope_guard city_raw="${fields.cityRaw}"`);
        markDoneThisRun(listing.listingId);
        await politeWait();
        continue;
      }

      const row: ListingRow = {
        listing_id: listing.listingId,
        source: "mamikos",
        url: listing.url,
        title: fields.title,
        price_raw_text: fields.priceRawText,
        price_inclusions_raw: fields.priceInclusionsRaw,
        city_raw: fields.cityRaw,
        area_raw: fields.areaRaw,
        address_raw: fields.addressRaw,
        latitude: fields.latitude,
        longitude: fields.longitude,
        gender_restriction_raw: fields.genderRestrictionRaw,
        room_type_raw: fields.roomTypeRaw,
        facilities_raw: fields.facilitiesRaw,
        description_raw: fields.descriptionRaw,
        availability_status_raw: fields.availabilityStatusRaw,
        rating: fields.rating,
        review_count: fields.reviewCount,
        image_urls: fields.imageUrls,
        scraped_at: now,
        crawl_type: "detail_refresh",
      };

      csvWriter.writeRow(row);
      store.recordRefreshSuccess(listing.listingId, now);
      log.success(listing.listingId, listing.url);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      // PRD §8: per-listing failures are logged and skipped, never abort the run.
      const retired = store.recordRefreshFailure(listing.listingId, now, reason);
      log.failure(listing.listingId, listing.url, retired ? `${reason} (retired)` : reason);
    }

    markDoneThisRun(listing.listingId);
    await politeWait();
  }
}

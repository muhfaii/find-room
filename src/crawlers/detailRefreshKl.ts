import type { Page } from "playwright";
import { isInKlangValleyScope } from "../config/klMudah.js";
import { politeWait } from "../config/politeness.js";
import { KnownListingsStore, type KnownListing } from "../lib/knownListings.js";
import { RunLogger } from "../lib/runLog.js";
import type { KlListingRow } from "../types/klListing.js";

export interface KlDetailFields {
  title: string;
  priceRawText: string;
  cityRaw: string;
  areaRaw: string | null;
  addressRaw: string | null;
  genderRestrictionRaw: string | null;
  descriptionRaw: string | null;
  facilitiesRaw: string[] | null; // building-level "Facilities" section
  amenitiesRaw: string[] | null; // room/unit-level "Amenities" section
  depositAmountRaw: string | null;
  depositTermsRaw: string | null;
  refundConditionsRaw: string | null;
  tenantPreferenceRaw: string | null;
  imageUrls: string[] | null;
}

// KL PRD §5 — detail-page extraction is DOM-based, NOT JSON-based. Mudah.my does
// not expose a window.detail-equivalent on detail pages (confirmed live
// 2026-08-28: __NEXT_DATA__.props.pageProps is empty there; a partial blob does
// exist under props.initialProps.pageProps.res but is undocumented and the PRD
// explicitly forbids depending on it). Stable selectors:
//   - title/location/size: [data-testid="description-header"] (the listing
//     subject — "ad-title" is just "Room For Rent, posted N min ago"),
//     "ad-location", "ad-detail-size"
//   - price: [data-testid="ad-price"] + its next-element-sibling suffix span
//     ("RM 700" + "per month" — preserves the exact display string verbatim)
//   - description: [data-testid="description"]
//   - "Property Details" grid: NO stable class — it's styled-components with
//     hashed classes (style__Text-sc-*). Matched on the literal label text:
//     find the <p> whose text is exactly "Rental Deposit" / "Tenant Preference"
//     and read its next element sibling as the value.
//   - "Facilities" (building) and "Amenities" (room) sections: find the
//     heading <p> by literal text, read the item labels inside its parent.
export async function extractDetailFieldsKl(page: Page): Promise<KlDetailFields> {
  // Explicit field-readiness waits (domcontentloaded + waitForSelector, not
  // networkidle — the site has continuous background analytics traffic, KL PRD
  // §8). The title is the key readiness signal; ad-price may render first.
  await page.waitForSelector('[data-testid="ad-price"]', { timeout: 15000 }).catch(() => {});
  await page.waitForSelector('[data-testid="description-header"]', { timeout: 15000 }).catch(() => {});

  return page.evaluate<KlDetailFields>(() => {
    const out: Record<string, unknown> = {};

    const title =
      (document.querySelector('[data-testid="description-header"]')?.textContent ?? "").trim() ||
      (document.querySelector('[data-testid="ad-title"]')?.textContent ?? "").trim();
    out.title = title;

    const priceEl = document.querySelector('[data-testid="ad-price"]');
    const priceText = priceEl ? (priceEl.textContent ?? "").trim() : "";
    const priceSuffix = priceEl?.nextElementSibling ? (priceEl.nextElementSibling.textContent ?? "").trim() : "";
    out.priceRawText = priceSuffix ? `${priceText} ${priceSuffix}`.trim() : priceText;

    const loc = (document.querySelector('[data-testid="ad-location"]')?.textContent ?? "").trim();
    const locParts = loc.split(",").map((s) => s.trim());
    out.areaRaw = locParts.length > 1 ? locParts[0] : null;
    out.cityRaw = locParts.length > 0 ? locParts[locParts.length - 1] : "";
    out.addressRaw = null; // no stable address selector on Mudah.my detail pages

    out.descriptionRaw = (document.querySelector('[data-testid="description"]')?.textContent ?? "").trim() || null;

    // Property Details grid — match on the literal label text (resilient to the
    // hashed styled-components classes, which change on every frontend deploy).
    // Shared by the grid (label -> single value) and the Facilities/Amenities
    // sections (heading -> list of item labels) below.
    const findParagraphsByText = (targets: string[]): HTMLParagraphElement[] =>
      Array.from(document.querySelectorAll("p")).filter((p) => targets.indexOf((p.textContent ?? "").trim()) !== -1);

    const grid: Record<string, string> = {};
    findParagraphsByText(["Property Type", "Furnishing", "Floor Range", "Rental Deposit", "Tenant Preference"]).forEach(
      (p) => {
        const text = (p.textContent ?? "").trim();
        const next = p.nextElementSibling;
        grid[text] = next ? (next.textContent ?? "").trim() : "";
      },
    );
    out.propertyTypeRaw = grid["Property Type"] ?? null;
    out.furnishingRaw = grid["Furnishing"] ?? null;
    out.floorRangeRaw = grid["Floor Range"] ?? null;
    out.depositAmountRaw = grid["Rental Deposit"] || null;
    out.tenantPreferenceRaw = grid["Tenant Preference"] || null;

    // No separate structured gender field exists on Mudah.my — "Tenant
    // Preference" (captured above, verbatim, as tenant_preference_raw) is the
    // only on-page signal, and it mixes gender and (occasionally) other tenant-
    // type text. Deriving a gender_restriction value from it is classification,
    // not verbatim capture, so it does NOT belong in the scraper (KL PRD §6.1
    // raw-field-only doctrine) — gender_restriction_raw stays null here, same
    // as Jakarta's convention of leaving a field null when no literal on-page
    // source exists for it. normalizeListingRowKl derives the gender_restriction
    // enum from tenant_preference_raw (and falls back to the title) downstream.
    out.genderRestrictionRaw = null;

    // Facilities (building-level) + Amenities (room-level) sections, matched by
    // literal heading text. Kept as two separate raw arrays — the PRD §5
    // distinction is preserved; normalization folds the amenity labels (and
    // any facilities labels that map) into the tag vocabulary downstream.
    const sections: Record<"facilities" | "amenities", string[]> = { facilities: [], amenities: [] };
    findParagraphsByText(["Facilities", "Amenities"]).forEach((p) => {
      const key = (p.textContent ?? "").trim().toLowerCase() as "facilities" | "amenities";
      const parent = p.parentElement;
      if (!parent) return;
      const labels: string[] = [];
      Array.from(parent.querySelectorAll("span, p")).forEach((el) => {
        if (el === p) return;
        const t = (el.textContent ?? "").trim();
        if (t && labels.indexOf(t) === -1) labels.push(t);
      });
      sections[key] = labels;
    });
    out.facilitiesRaw = sections.facilities.length > 0 ? sections.facilities : null;
    out.amenitiesRaw = sections.amenities.length > 0 ? sections.amenities : null;

    // deposit_terms_raw / refund_conditions_raw have no literal on-page field
    // either — the only signal is free text buried in the description, which
    // requires pattern-matching to find. That's classification, not verbatim
    // capture, so — same reasoning as gender_restriction_raw above — it does
    // NOT belong here. Both stay null at scrape time; normalizeListingRowKl
    // (workers/ingest-kl/src/normalize.ts) does the best-effort text scan over
    // description_raw downstream, where the rest of this deployment's parsing
    // already lives.
    out.depositTermsRaw = null;
    out.refundConditionsRaw = null;

    // Gallery photos — the only cdn.rnudah.com/images/plain/ images on the
    // detail page are the listing's own gallery (logos/static assets live on
    // mcdn.mudah.my).
    out.imageUrls = (() => {
      const urls: string[] = [];
      Array.from(document.querySelectorAll('img[src*="cdn.rnudah.com/images/plain/"]')).forEach((img) => {
        const src = img.getAttribute("src") ?? "";
        if (src && urls.indexOf(src) === -1) urls.push(src);
      });
      return urls;
    })();

    return out as unknown as KlDetailFields;
  });
}

export async function runDetailRefreshCrawlKl(
  page: Page,
  listings: KnownListing[],
  ingest: (row: KlListingRow) => Promise<void>,
  retire: (listingId: string) => Promise<void>,
  store: KnownListingsStore,
  log: RunLogger,
  isAlreadyDoneThisRun: (listingId: string) => boolean,
  markDoneThisRun: (listingId: string) => void,
): Promise<void> {
  for (const listing of listings) {
    // KL PRD §8 resumability: skip listings already completed earlier in this
    // same run.
    if (isAlreadyDoneThisRun(listing.listingId)) continue;

    const now = new Date().toISOString();
    try {
      // domcontentloaded, not networkidle — same reasoning as Jakarta (the site
      // has continuous background ad/analytics traffic). extractDetailFieldsKl
      // has its own explicit readiness waits.
      await page.goto(listing.url, { waitUntil: "domcontentloaded" });
      const fields = await extractDetailFieldsKl(page);

      // Scope guard applies on refresh too — a listing could be re-categorized
      // or its location text changed since it was first discovered.
      const locationRaw = fields.areaRaw && fields.cityRaw ? `${fields.areaRaw}, ${fields.cityRaw}` : fields.cityRaw;
      if (!isInKlangValleyScope(locationRaw)) {
        log.skip(listing.listingId, listing.url, `scope_guard location="${locationRaw}"`);
        markDoneThisRun(listing.listingId);
        await politeWait();
        continue;
      }

      const row: KlListingRow = {
        listing_id: listing.listingId,
        source: "mudah",
        url: listing.url,
        title: fields.title,
        price_raw_text: fields.priceRawText,
        price_inclusions_raw: null,
        city_raw: fields.cityRaw,
        area_raw: fields.areaRaw,
        address_raw: fields.addressRaw,
        latitude: null,
        longitude: null,
        gender_restriction_raw: fields.genderRestrictionRaw,
        room_type_raw: null, // parsed downstream from title/description (KL PRD §5)
        facilities_raw: fields.facilitiesRaw,
        amenities_raw: fields.amenitiesRaw,
        description_raw: fields.descriptionRaw,
        availability_status_raw: null, // no availability signal on Mudah.my detail pages
        deposit_amount_raw: fields.depositAmountRaw,
        deposit_terms_raw: fields.depositTermsRaw,
        refund_conditions_raw: fields.refundConditionsRaw,
        tenant_preference_raw: fields.tenantPreferenceRaw,
        rating: null,
        review_count: null,
        image_urls: fields.imageUrls,
        scraped_at: now,
        crawl_type: "detail_refresh",
      };

      await ingest(row);
      store.recordRefreshSuccess(listing.listingId, now);
      log.success(listing.listingId, listing.url);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      // KL PRD §8: per-listing failures are logged and skipped, never abort the
      // run; RETIREMENT_FAILURE_THRESHOLD consecutive failures auto-retire.
      const retired = store.recordRefreshFailure(listing.listingId, now, reason);
      log.failure(listing.listingId, listing.url, retired ? `${reason} (retired)` : reason);
      if (retired) {
        // retire() is internally retried + dead-lettered on failure, never throws.
        await retire(listing.listingId);
      }
    }

    markDoneThisRun(listing.listingId);
    await politeWait();
  }
}

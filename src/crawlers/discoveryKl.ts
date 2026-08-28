import type { Page } from "playwright";
import { KL_MUDAH_SEEDS, isInKlangValleyScope } from "../config/klMudah.js";
import { politeWait } from "../config/politeness.js";
import { KnownListingsStore } from "../lib/knownListings.js";
import { RunLogger } from "../lib/runLog.js";
import { computeCardSignature } from "../lib/signature.js";
import type { KlListingRow } from "../types/klListing.js";

// KL PRD §4 — discovery differs materially from Mamikos: Mudah.my's search-page
// cards carry a real, static listing URL and listing ID in the DOM, and the
// page embeds the full card list as structured JSON
// (`window.__NEXT_DATA__.props.pageProps.initialStore.ads` / `.featuredAds`,
// confirmed live 2026-08-28 — each ad carries listId, subject, priceLabel +
// priceSuffix, subareaName, regionName, locationLabel, adviewUrl, images). So a
// KL discovery crawler harvests (listId, url) pairs directly from that JSON —
// no click budget, no new-tab handling (the `DailyClickBudget` /
// clickWithRetry flow in discovery.ts is Mamikos-specific plumbing Mudah.my
// does not need). Pagination is numbered (`?o=N`, confirmed via
// `pageProps.paginateMetadata.next`), not the repeated-click-until-count-grows
// pattern.
//
// The discovery row is intentionally lightweight: detail-page-only fields
// (deposit, tenant preference, room type, description, facilities/amenities)
// are filled in by the weekly-sharded detail-refresh pass.

interface MudahCard {
  listingId: string;
  url: string;
  title: string;
  priceRawText: string;
  cityRaw: string;
  areaRaw: string | null;
  locationRaw: string;
  imageUrls: string[];
}

interface PageState {
  cards: MudahCard[];
  nextUrl: string | null;
}

// Safety cap on pagination depth per seed — the largest seed (Kuala Lumpur,
// ~3,771 results at 40/page) is ~95 pages; 200 is generous headroom against a
// site change that would otherwise loop forever.
const MAX_PAGES_PER_SEED = 200;

// Confirmed readiness signal: initialStore.ads must exist (server-rendered into
// __NEXT_DATA__). domcontentloaded is the navigation wait, not networkidle —
// Mudah.my is a JS-heavy SPA with continuous background analytics/ad traffic
// (KL PRD §8; the same reason Jakarta's crawler avoids networkidle).
async function waitForSearchState(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const raw = document.getElementById("__NEXT_DATA__")?.textContent;
      if (!raw) return false;
      try {
        const data = JSON.parse(raw);
        return Array.isArray(data?.props?.pageProps?.initialStore?.ads);
      } catch {
        return false;
      }
    },
    { timeout: 20000 },
  );
}

// Reads the card list + next-page URL straight from __NEXT_DATA__ (robust and
// cheap vs CSS-scraping each card — KL PRD §4). Merges the regular `ads` and
// `featuredAds` arrays (featured ads are a separate top-of-page array and are
// mostly NOT duplicated in `ads`), deduped by listId.
async function extractPageState(page: Page): Promise<PageState> {
  return page.evaluate<{ cards: MudahCard[]; nextUrl: string | null }>(() => {
    const raw = document.getElementById("__NEXT_DATA__")?.textContent;
    if (!raw) return { cards: [], nextUrl: null };
    const data = JSON.parse(raw);
    const pageProps = data?.props?.pageProps;
    const store = pageProps?.initialStore;
    const allAds = [
      ...(Array.isArray(store?.ads) ? store.ads : []),
      ...(Array.isArray(store?.featuredAds) ? store.featuredAds : []),
    ];

    const seen = new Set<string>();
    const cards: MudahCard[] = [];
    allAds.forEach((ad) => {
      const a = ad?.attributes ?? {};
      const listId = String(a.listId ?? "");
      if (!listId || seen.has(listId)) return;
      seen.add(listId);
      const priceLabel = typeof a.priceLabel === "string" ? a.priceLabel : "";
      const priceSuffix = typeof a.priceSuffix === "string" ? a.priceSuffix : "";
      const priceRawText = priceSuffix ? `${priceLabel} ${priceSuffix}`.trim() : priceLabel;
      const regionName = typeof a.regionName === "string" ? a.regionName : "";
      const subareaName = typeof a.subareaName === "string" ? a.subareaName : "";
      const locationLabel = typeof a.locationLabel === "string" ? a.locationLabel : "";
      const image = typeof a.image === "string" ? a.image : "";
      const extraImages = Array.isArray(a.extraImages)
        ? a.extraImages.filter((u: unknown): u is string => typeof u === "string")
        : [];
      const imageUrls = image ? [image, ...extraImages] : extraImages;
      cards.push({
        listingId: listId,
        url: typeof a.adviewUrl === "string" ? a.adviewUrl : "",
        title: typeof a.subject === "string" ? a.subject : "",
        priceRawText,
        cityRaw: regionName,
        areaRaw: subareaName || null,
        locationRaw: locationLabel || (subareaName && regionName ? `${subareaName}, ${regionName}` : regionName),
        imageUrls,
      });
    });

    let nextUrl: string | null = null;
    const paginateMetadata = pageProps?.paginateMetadata;
    if (paginateMetadata && typeof paginateMetadata.next === "string" && paginateMetadata.next.length > 0) {
      nextUrl = paginateMetadata.next;
    }
    return { cards, nextUrl };
  });
}

async function processCard(
  card: MudahCard,
  ingest: (row: KlListingRow) => Promise<void>,
  store: KnownListingsStore,
  log: RunLogger,
): Promise<void> {
  const now = new Date().toISOString();

  // KL PRD §7 scope guard: verify each listing's actual location text against
  // the 7-city allowlist, since a cross-promo/featured ad can surface a listing
  // from outside its own city's seed page.
  if (!isInKlangValleyScope(card.locationRaw)) {
    log.skip(card.listingId, card.url, `scope_guard location="${card.locationRaw}"`);
    return;
  }

  const signature = computeCardSignature(card.cityRaw, card.areaRaw, card.title, card.priceRawText);
  const known = store.findBySignature(signature);

  const row: KlListingRow = {
    listing_id: card.listingId,
    source: "mudah",
    url: card.url,
    title: card.title,
    price_raw_text: card.priceRawText,
    price_inclusions_raw: null,
    city_raw: card.cityRaw,
    area_raw: card.areaRaw,
    address_raw: null,
    latitude: null,
    longitude: null,
    gender_restriction_raw: null,
    room_type_raw: null,
    facilities_raw: null,
    amenities_raw: null,
    description_raw: null,
    availability_status_raw: null,
    deposit_amount_raw: null,
    deposit_terms_raw: null,
    refund_conditions_raw: null,
    tenant_preference_raw: null,
    rating: null,
    review_count: null,
    image_urls: card.imageUrls.length > 0 ? card.imageUrls : null,
    scraped_at: now,
    crawl_type: "discovery",
  };
  await ingest(row);

  // New listing — record it in the known-listings store so the weekly-sharded
  // detail-refresh pass picks up its full detail fields. (Reuses the shared
  // store's record-on-discovery method; there is no click on Mudah.my, but the
  // record semantics — capture the listing + defer its next refresh — are the
  // same. Idempotent: already-known ids are skipped inside.)
  if (!known) {
    store.upsertFromDiscoveryClick(card.listingId, card.url, card.cityRaw, signature, now);
  }
  log.success(card.listingId, card.url);
}

export async function runDiscoveryCrawlKl(
  page: Page,
  ingest: (row: KlListingRow) => Promise<void>,
  store: KnownListingsStore,
  log: RunLogger,
): Promise<void> {
  for (const seed of KL_MUDAH_SEEDS) {
    try {
      await runSeedDiscovery(page, seed, ingest, store, log);
    } catch (err) {
      // A page-level failure must not abort the whole run — log it and move to
      // the next seed (KL PRD §8 resilience philosophy at page level).
      const reason = err instanceof Error ? err.message : String(err);
      log.failure("(seed)", seed.seedUrl, reason);
    }
    await politeWait();
  }
}

async function runSeedDiscovery(
  page: Page,
  seed: (typeof KL_MUDAH_SEEDS)[number],
  ingest: (row: KlListingRow) => Promise<void>,
  store: KnownListingsStore,
  log: RunLogger,
): Promise<void> {
  log.info(`Discovery: navigating to seed for ${seed.cityLabel}`);
  let pageUrl: string | null = seed.seedUrl;
  let pageNum = 0;
  const seenThisRun = new Set<string>();

  // Follow paginateMetadata.next (?o=N) until exhausted — the numbered,
  // server-rendered pagination Mudah.my actually uses (KL PRD §4).
  while (pageUrl && pageNum < MAX_PAGES_PER_SEED) {
    pageNum += 1;
    await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
    await waitForSearchState(page);

    const { cards, nextUrl } = await extractPageState(page);
    log.info(`Seed ${seed.cityLabel} page=${pageNum} cards=${cards.length}`);

    for (const card of cards) {
      if (seenThisRun.has(card.listingId)) continue;
      seenThisRun.add(card.listingId);
      await processCard(card, ingest, store, log);
    }

    if (cards.length === 0) break;
    if (!nextUrl) break;
    pageUrl = new URL(nextUrl, pageUrl).href;
    await politeWait();
  }
}

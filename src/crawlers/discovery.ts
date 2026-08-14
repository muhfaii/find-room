import type { Page } from "playwright";
import { JAKARTA_SEEDS, isInJakartaScope } from "../config/jakarta.js";
import { politeWait } from "../config/politeness.js";
import { CsvRunWriter } from "../lib/csv.js";
import { KnownListingsStore } from "../lib/knownListings.js";
import { RunLogger } from "../lib/runLog.js";
import { computeCardSignature } from "../lib/signature.js";
import { DailyClickBudget } from "../lib/clickBudget.js";
import { extractDetailFields } from "./detailRefresh.js";
import { clickWithRetry } from "../lib/retry.js";
import type { ListingRow } from "../types/listing.js";

interface DiscoveredCard {
  title: string;
  areaRaw: string | null;
  priceRawText: string;
  availabilityStatusRaw: string | null;
}

// PRD §4: discovery visits only the 5 fixed Jakarta seed URLs (bulanan/monthly
// rentals only — see config/jakarta.ts), paginating through the FULL result set
// on each. Confirmed against a live search page on 2026-08-02
// (data/dom-snapshots/search-bulanan-jakarta-pusat.html):
//   - card container: [data-testid="nominatimRoomCard"]
//   - title: .rc-info__name, area/district: .rc-info__location
//   - price: .rc-price__text + .rc-price__type
//   - "load more" pagination: button.nominatim-list__see-more (click until absent)
//
// city_raw for these lightweight card rows is NOT read from the card itself —
// cards only show area/district text (e.g. "Menteng"), not the full city name.
// We use the seed's own cityLabel instead, since Mamikos buckets search results
// by city via the URL. This is weaker than reading literal on-page text, but the
// scope guard still gets a real, literal city_raw check once per listing — at
// first-click time, from the detail page's window.detail.area_city (see below) —
// so every listing is verified against Jakarta scope at least once.
async function extractCardsFromPage(page: Page): Promise<DiscoveredCard[]> {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[data-testid="nominatimRoomCard"]'));
    return cards.map((card) => {
      const priceText = card.querySelector(".rc-price__text")?.textContent?.trim() ?? "";
      const priceType = card.querySelector(".rc-price__type")?.textContent?.trim() ?? "";
      return {
        title: card.querySelector(".rc-info__name")?.textContent?.trim() ?? "",
        areaRaw: card.querySelector(".rc-info__location")?.textContent?.trim() ?? null,
        priceRawText: priceType ? `${priceText} ${priceType}` : priceText,
        // TODO: no confirmed literal availability text at card level yet (PRD §5
        // allows this to stay empty — never inferred from a badge/color signal).
        availabilityStatusRaw: null,
      };
    });
  });
}

async function loadAllCards(page: Page, log: RunLogger): Promise<DiscoveredCard[]> {
  let previousCount = -1;
  let cards = await extractCardsFromPage(page);

  while (cards.length > previousCount) {
    previousCount = cards.length;
    const seeMore = page.locator("button.nominatim-list__see-more");
    if ((await seeMore.count()) === 0) break;
    await politeWait();
    await clickWithRetry(() => seeMore.click());
    await page.waitForTimeout(1500); // let newly appended cards render
    cards = await extractCardsFromPage(page);
  }

  log.info(`Loaded ${cards.length} cards after full pagination`);
  return cards;
}

export async function runDiscoveryCrawl(
  page: Page,
  csvWriter: CsvRunWriter,
  store: KnownListingsStore,
  log: RunLogger,
  clickBudget: DailyClickBudget,
): Promise<void> {
  for (const seed of JAKARTA_SEEDS) {
    try {
      await runSeedDiscovery(page, seed, csvWriter, store, log, clickBudget);
    } catch (err) {
      // A page-level failure (e.g. pagination stuck behind a persistent overlay)
      // must not abort the whole run — log it and move to the next seed, per the
      // PRD §8 resilience philosophy extended to page-level, not just per-listing.
      const reason = err instanceof Error ? err.message : String(err);
      log.failure("(seed)", seed.seedUrl, reason);
    }
    await politeWait();
  }
}

async function runSeedDiscovery(
  page: Page,
  seed: (typeof JAKARTA_SEEDS)[number],
  csvWriter: CsvRunWriter,
  store: KnownListingsStore,
  log: RunLogger,
  clickBudget: DailyClickBudget,
): Promise<void> {
  log.info(`Discovery: navigating to seed for ${seed.cityLabel}`);
  // domcontentloaded, not networkidle — confirmed in testing that networkidle can
  // hang 30s+ and never resolve on this site (continuous background ad/analytics
  // traffic). The explicit waitForFunction below is the real readiness signal.
  await page.goto(seed.seedUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.includes("Rp"), { timeout: 20000 });

  const cards = await loadAllCards(page, log);

  for (const card of cards) {
      const now = new Date().toISOString();
      // city_raw for the signature/lightweight row uses the seed's cityLabel —
      // see extractCardsFromPage's comment above for why.
      const signature = computeCardSignature(seed.cityLabel, card.areaRaw, card.title, card.priceRawText);
      const known = store.findBySignature(signature);

      if (known) {
        // Already known — reuse its listingId/url, no click needed.
        const row: ListingRow = {
          listing_id: known.listingId,
          source: "mamikos",
          url: known.url,
          title: card.title,
          price_raw_text: card.priceRawText,
          price_inclusions_raw: null,
          city_raw: known.cityRaw,
          area_raw: card.areaRaw,
          address_raw: null,
          latitude: null,
          longitude: null,
          gender_restriction_raw: null,
          room_type_raw: null,
          facilities_raw: null,
          description_raw: null,
          availability_status_raw: card.availabilityStatusRaw,
          rating: null,
          review_count: null,
          image_urls: null,
          scraped_at: now,
          crawl_type: "discovery",
        };
        csvWriter.writeRow(row);
        log.success(known.listingId, known.url);
        continue;
      }

      // New card — needs a click to learn its URL at all (PRD §4: no static href
      // exists on cards). Capped by the daily click budget for cold-start safety.
      if (!clickBudget.hasRemaining()) {
        log.skip("(unknown)", "(unknown)", `click_budget_exhausted signature=${signature}`);
        continue;
      }

      const cardLocator = page.locator('[data-testid="nominatimRoomCard"]').nth(cards.indexOf(card));
      const newPagePromise = page.context().waitForEvent("page", { timeout: 10000 }).catch(() => null);
      await clickWithRetry(() => cardLocator.click());
      const newPage = await newPagePromise;
      clickBudget.recordClick();

      if (!newPage) {
        log.failure("(unknown)", "(unknown)", `click_did_not_open_tab signature=${signature}`);
        await politeWait();
        continue;
      }

      try {
        await newPage.waitForLoadState("domcontentloaded");
        const fields = await extractDetailFields(newPage);
        // Strip tracking query params (e.g. ?redirection_source=...) — §5 wants
        // the canonical listing URL, not the referrer-tagged variant.
        const parsedUrl = new URL(newPage.url());
        const url = `${parsedUrl.origin}${parsedUrl.pathname}`;
        const listingId = parsedUrl.pathname.split("/").filter(Boolean).pop() ?? "";

        if (!isInJakartaScope(fields.cityRaw)) {
          log.skip(listingId, url, `scope_guard city_raw="${fields.cityRaw}"`);
          await newPage.close();
          await politeWait();
          continue;
        }

        const row: ListingRow = {
          listing_id: listingId,
          source: "mamikos",
          url,
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
          crawl_type: "discovery",
        };

        csvWriter.writeRow(row);
        store.upsertFromDiscoveryClick(listingId, url, fields.cityRaw, signature, now);
        log.success(listingId, url);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        log.failure("(unknown)", newPage.url(), reason);
      } finally {
        await newPage.close();
      }

      await politeWait();
  }
}

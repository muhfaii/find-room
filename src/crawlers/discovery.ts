import type { Locator, Page } from "playwright";
import { JAKARTA_SEEDS, isInJakartaScope } from "../config/jakarta.js";
import { politeWait } from "../config/politeness.js";
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

// Clicks an element that an overlay (ad slot, cookie banner, toast, ...) may be
// covering. Playwright's normal click refuses to act when another element would
// receive the pointer event ("<html> intercepts pointer events"), so escalate:
//   1. normal click (short timeout — a transient overlay often clears quickly)
//   2. force click: skips the actionability/hit-target checks and dispatches the
//      mouse event at the element's position
//   3. DOM click(): invokes the element's click handler directly, so it works even
//      if the overlay is still physically on top
// Also used for listing cards. The DOM-click fallback runs through Playwright's
// evaluate (which carries user activation), so a card handler's window.open can
// still open the listing tab; if it does not, the caller logs click_did_not_open_tab.
async function describeBlocker(target: Locator): Promise<string> {
  // What is actually under the pointer where the target sits, plus page/tab state
  // that commonly leaves a page un-clickable. NOTE: tsx/esbuild injects a `__name`
  // helper for any named function/const-arrow inside a function literal, and that
  // helper does not exist in the browser page — so this callback uses only inline
  // anonymous lambdas (no `const f = () => ...`).
  return target
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      const stack = document
        .elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        .slice(0, 4)
        .map((n) => n.tagName.toLowerCase() + (n.id ? "#" + n.id : "") + "." + String(n.className).slice(0, 50));
      return (
        `stackAtPoint=[${stack.join(" > ")}] html.class="${document.documentElement.className.slice(0, 60)}" ` +
        `body.style="${(document.body.getAttribute("style") ?? "").slice(0, 80)}" ` +
        `bodyPointerEvents=${getComputedStyle(document.body).pointerEvents} ` +
        `visibility=${document.visibilityState} hasFocus=${document.hasFocus()}`
      );
    }, undefined, { timeout: 3_000 })
    .catch((err) => `blocker details unavailable (${String(err?.message ?? err).split("\n")[0]})`);
}

// The card's own markup, to see whether it carries a link/slug we could read
// without clicking. Logged only a couple of times per run to keep the log small.
let cardMarkupLogged = 0;
async function logCardMarkup(card: Locator, log: RunLogger): Promise<void> {
  if (cardMarkupLogged >= 2) return;
  cardMarkupLogged += 1;
  const html = await card
    .evaluate((el) => el.outerHTML.replace(/\s+/g, " ").slice(0, 900), undefined, { timeout: 3_000 })
    .catch(() => "unavailable");
  log.info(`card markup: ${html}`);
}

async function clickThroughOverlay(button: Locator, log: RunLogger, label = "pagination"): Promise<void> {
  try {
    await button.click({ timeout: 5_000 });
    return;
  } catch {
    log.info(`${label}: normal click blocked — ${await describeBlocker(button)}`);
  }
  await button.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => {});
  // DOM click before force click: a force click reports success even when the
  // pointer lands on whatever covers the button (the click is "sent", just not to
  // the button), while a DOM click invokes the button's own handler.
  await button.evaluate((el) => (el as HTMLElement).click(), undefined, { timeout: 5_000 });
  log.info(`${label}: DOM click used`);
}

// Opens a listing card in its new tab and returns that tab, or null if nothing
// opened. The click only counts if a tab appears, so each method is followed by a
// check — "click did not throw" is not evidence the card received it:
//   1. normal click (fails when something covers the card)
//   2. DOM click on the card element
//   3. force click at the card's position
async function openCardTab(page: Page, card: Locator, log: RunLogger): Promise<Page | null> {
  const attempt = async (action: () => Promise<void>): Promise<Page | null> => {
    const tab = page.context().waitForEvent("page", { timeout: 8_000 }).catch(() => null);
    try {
      await action();
    } catch (err) {
      log.info(`card click: method failed — ${String(err instanceof Error ? err.message : err).split("\n")[0]}`);
      return null;
    }
    return tab;
  };

  let normalClickThrew = false;
  const viaNormal = await attempt(async () => {
    try {
      await card.click({ timeout: 5_000 });
    } catch (err) {
      normalClickThrew = true;
      throw err;
    }
  });
  if (viaNormal) return viaNormal;
  // The click went through but no tab opened: report that, don't double-click.
  if (!normalClickThrew) return null;

  log.info(`card click: normal click blocked — ${await describeBlocker(card)}`);
  await logCardMarkup(card, log);

  const viaDom = await attempt(() => card.evaluate((el) => (el as HTMLElement).click(), undefined, { timeout: 5_000 }));
  if (viaDom) {
    log.info("card click: DOM click opened the tab");
    return viaDom;
  }
  const viaForce = await attempt(() => card.click({ force: true, timeout: 5_000 }));
  if (viaForce) log.info("card click: force click opened the tab");
  return viaForce;
}

const MAX_CONSECUTIVE_CLICK_FAILURES = 3;

async function loadAllCards(page: Page, log: RunLogger): Promise<DiscoveredCard[]> {
  let previousCount = -1;
  let cards = await extractCardsFromPage(page);
  let stopReason = "no new cards after the last click";
  let clicks = 0;

  while (cards.length > previousCount) {
    previousCount = cards.length;
    const seeMore = page.locator("button.nominatim-list__see-more");
    if ((await seeMore.count()) === 0) {
      stopReason = "no load-more button on the page";
      break;
    }
    await politeWait();
    try {
      await clickWithRetry(() => clickThroughOverlay(seeMore.first(), log));
    } catch (err) {
      stopReason = `load-more click failed: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`;
      break;
    }
    clicks += 1;
    await page.waitForTimeout(1500); // let newly appended cards render
    cards = await extractCardsFromPage(page);
  }

  // The stop reason makes it visible whether a short list means the site really
  // has few cards, the button selector no longer matches, or clicks were blocked.
  log.info(`Pagination stopped after ${clicks} click(s): ${stopReason}`);
  log.info(`Loaded ${cards.length} cards after full pagination`);
  return cards;
}

export async function runDiscoveryCrawl(
  page: Page,
  ingest: (row: ListingRow) => Promise<void>,
  store: KnownListingsStore,
  log: RunLogger,
  clickBudget: DailyClickBudget,
): Promise<void> {
  for (const seed of JAKARTA_SEEDS) {
    try {
      await runSeedDiscovery(page, seed, ingest, store, log, clickBudget);
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
  ingest: (row: ListingRow) => Promise<void>,
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
  let consecutiveClickFailures = 0;

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
        await ingest(row);
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
      // A background tab can leave the list page un-clickable after a listing tab
      // was opened and closed, so always bring it back to the front first.
      await page.bringToFront().catch(() => {});
      const newPage = await openCardTab(page, cardLocator, log);
      clickBudget.recordClick();

      if (!newPage) {
        // One stuck card must not abandon the whole city. Skip it, but give up on
        // the city after a few in a row since the page itself is likely wedged.
        log.failure("(unknown)", seed.seedUrl, `click_did_not_open_tab signature=${signature}`);
        consecutiveClickFailures += 1;
        if (consecutiveClickFailures >= MAX_CONSECUTIVE_CLICK_FAILURES) {
          throw new Error(`gave up on ${seed.cityLabel} after ${consecutiveClickFailures} card clicks in a row failed`);
        }
        await politeWait();
        continue;
      }
      consecutiveClickFailures = 0;

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

        await ingest(row);
        store.upsertFromDiscoveryClick(listingId, url, fields.cityRaw, signature, now);
        log.success(listingId, url);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        log.failure("(unknown)", newPage.url(), reason);
      } finally {
        await newPage.close();
        await page.bringToFront().catch(() => {});
      }

      await politeWait();
  }
}

import type { Page } from "playwright";
import { KL_IBILIK_SEEDS } from "../config/klIbilik.js";
import { isInKlangValleyScope } from "../config/klangValley.js";
import { politeWait } from "../config/politeness.js";
import { KnownListingsStore } from "../lib/knownListings.js";
import { RunLogger } from "../lib/runLog.js";
import { computeCardSignature } from "../lib/signature.js";
import { buildLightweightIbilikRow, extractIbilikSearchPage, ibilikScopeText } from "./ibilikExtract.js";
import type { KlIbilikListingRow } from "../types/klIbilikListing.js";

// KL iBilik PRD §2/§4: cards are lightweight (id, href, title, price,
// location, ...) — no room_type/preferences/deposit fields, those only exist
// on the detail page. Discovery captures the lightweight row (same two-tier
// model as Mudah.my); detail-refresh fills in the rest.
//
// Kuala Lumpur is the largest seed by far (~10,111 results at 40/page, ~253
// pages, confirmed 2026-08-28) — a generous headroom cap, not the ~200 used
// for Mudah.my's much smaller catalog.
const MAX_PAGES_PER_SEED = 300;

// KL iBilik PRD §3's taxonomy note: the Kuala Lumpur SEED is a state-level
// page, but individual listings' own address text (card.location, e.g.
// "Taman Mutiara Barat, Cheras") often won't literally contain "Kuala
// Lumpur" — a sub-district name alone doesn't match the scope keyword list.
// Trust that seed's own scoping rather than rejecting genuinely in-scope
// listings for a keyword-matching artifact; the strict per-listing check
// still runs at detail-refresh time against the authoritative structured
// state/city taxonomy (ibilikExtract.ts's buildFullIbilikRow), which doesn't
// have this ambiguity. Every other seed's own city name does appear literally
// in its own listings' address text, so the strict check applies normally.
const SEEDS_TRUSTED_WITHOUT_CARD_SCOPE_CHECK = new Set(["Kuala Lumpur"]);

async function processCard(
  card: Parameters<typeof buildLightweightIbilikRow>[0],
  seedCityLabel: string,
  ingest: (row: KlIbilikListingRow) => Promise<void>,
  store: KnownListingsStore,
  log: RunLogger,
): Promise<void> {
  const now = new Date().toISOString();
  const row = buildLightweightIbilikRow(card, now, "discovery");

  if (!SEEDS_TRUSTED_WITHOUT_CARD_SCOPE_CHECK.has(seedCityLabel) && !isInKlangValleyScope(ibilikScopeText(row))) {
    log.skip(row.listing_id, row.url, `scope_guard location="${ibilikScopeText(row)}"`);
    return;
  }

  await ingest(row);

  const signature = computeCardSignature(row.address_raw ?? "", null, row.title, row.price_raw_text);
  store.upsertFromDiscoveryClick(row.listing_id, row.url, row.address_raw ?? "", signature, now);
  log.success(row.listing_id, row.url);
}

async function runSeedDiscovery(
  page: Page,
  seed: (typeof KL_IBILIK_SEEDS)[number],
  ingest: (row: KlIbilikListingRow) => Promise<void>,
  store: KnownListingsStore,
  log: RunLogger,
): Promise<void> {
  log.info(`Discovery: navigating to seed for ${seed.cityLabel}`);
  let pageNum = 1;

  while (pageNum <= MAX_PAGES_PER_SEED) {
    const pageUrl = pageNum === 1 ? seed.seedUrl : `${seed.seedUrl}?page=${pageNum}`;
    await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
    const { cards, totalPages } = await extractIbilikSearchPage(page);
    log.info(`Seed ${seed.cityLabel} page=${pageNum}/${totalPages || "?"} cards=${cards.length}`);

    for (const card of cards) {
      await processCard(card, seed.cityLabel, ingest, store, log);
    }

    if (cards.length === 0) break;
    if (pageNum >= totalPages) break;
    pageNum += 1;
    await politeWait();
  }
}

export async function runDiscoveryCrawlIbilikKl(
  page: Page,
  ingest: (row: KlIbilikListingRow) => Promise<void>,
  store: KnownListingsStore,
  log: RunLogger,
): Promise<void> {
  for (const seed of KL_IBILIK_SEEDS) {
    try {
      await runSeedDiscovery(page, seed, ingest, store, log);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log.failure("(seed)", seed.seedUrl, reason);
    }
    await politeWait();
  }
}

import type { Page } from "playwright";
import { KL_SPEEDHOME_SEEDS } from "../config/klSpeedhome.js";
import { isInKlangValleyScope } from "../config/klangValley.js";
import { politeWait } from "../config/politeness.js";
import { KnownListingsStore } from "../lib/knownListings.js";
import { RunLogger } from "../lib/runLog.js";
import { computeCardSignature } from "../lib/signature.js";
import { extractSpeedhomeFields, type SpeedhomeRawRecord } from "./speedhomeExtract.js";
import type { SpeedhomeListingRow } from "../types/klSpeedhomeListing.js";

// KL Speedhome PRD §4: every search-result card already carries the full,
// already-typed property record (id, slug, roomType, deposit fields, tenant
// preference, ...) via window.__NEXT_DATA__.props.pageProps.propertyList —
// there is no click-to-learn-URL step (same simplification as Mudah.my vs.
// Mamikos) and no lightweight-vs-full-detail split either (unlike Mudah.my):
// discovery captures the complete record on every pass, since the JSON is
// already there for free. Pagination is `?page=N` (confirmed live
// 2026-08-28), and `propertyList.totalPages` tells us exactly when to stop —
// no page-until-empty guessing needed.

// Safety cap on pagination depth per seed, same defensive purpose as Mudah.my's
// MAX_PAGES_PER_SEED — headroom against a site change that would otherwise
// loop forever.
const MAX_PAGES_PER_SEED = 50;

interface PropertyListPage {
  content: SpeedhomeRawRecord[];
  totalPages: number;
}

// Confirmed readiness signal: propertyList.content must exist (server-rendered
// into __NEXT_DATA__). domcontentloaded, not networkidle — not yet confirmed
// whether Speedhome has the same continuous-background-traffic problem
// Mamikos/Mudah.my do (KL Speedhome PRD §8), but the explicit wait here is the
// real readiness signal regardless.
async function waitForSearchState(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const raw = document.getElementById("__NEXT_DATA__")?.textContent;
      if (!raw) return false;
      try {
        const data = JSON.parse(raw);
        return Array.isArray(data?.props?.pageProps?.propertyList?.content);
      } catch {
        return false;
      }
    },
    { timeout: 20000 },
  );
}

async function extractPropertyListPage(page: Page): Promise<PropertyListPage> {
  return page.evaluate<PropertyListPage>(() => {
    const raw = document.getElementById("__NEXT_DATA__")?.textContent;
    if (!raw) return { content: [], totalPages: 0 };
    const data = JSON.parse(raw);
    const propertyList = data?.props?.pageProps?.propertyList;
    return {
      content: Array.isArray(propertyList?.content) ? propertyList.content : [],
      totalPages: typeof propertyList?.totalPages === "number" ? propertyList.totalPages : 0,
    };
  });
}

function scopeLocationText(row: SpeedhomeListingRow): string | null {
  // KL Speedhome PRD §5: `city` is confirmed nullable — fall back to the
  // free-text address rather than letting a null city silently pass scope.
  return row.city_raw ?? row.address_raw;
}

async function processRecord(
  record: SpeedhomeRawRecord,
  ingest: (row: SpeedhomeListingRow) => Promise<void>,
  store: KnownListingsStore,
  log: RunLogger,
): Promise<void> {
  // KL Speedhome PRD §5: re-verify type === "ROOM" per listing rather than
  // trusting the /room seed URL alone — same "verify scope guard on every
  // listing" doctrine as the city check below.
  if (record.type !== "ROOM") {
    log.skip(String(record.id ?? "(unknown)"), "(n/a)", `wrong_type type="${record.type}"`);
    return;
  }

  const now = new Date().toISOString();
  const row = extractSpeedhomeFields(record, now, "discovery");

  if (!isInKlangValleyScope(scopeLocationText(row))) {
    log.skip(row.listing_id, row.url, `scope_guard location="${scopeLocationText(row)}"`);
    return;
  }

  await ingest(row);

  // Speedhome always gives us the real id up front (no click-to-discover
  // needed), so this is really just recording a known listing for the
  // detail-refresh shard rotation — upsertFromDiscoveryClick is idempotent,
  // so calling it on every pass (not just "if new") is harmless and simpler
  // than tracking new-vs-known ourselves.
  const signature = computeCardSignature(row.city_raw ?? "", row.area_raw, row.title, row.price_raw_text);
  store.upsertFromDiscoveryClick(row.listing_id, row.url, row.city_raw ?? "", signature, now);
  log.success(row.listing_id, row.url);
}

async function runSeedDiscovery(
  page: Page,
  seed: (typeof KL_SPEEDHOME_SEEDS)[number],
  ingest: (row: SpeedhomeListingRow) => Promise<void>,
  store: KnownListingsStore,
  log: RunLogger,
): Promise<void> {
  log.info(`Discovery: navigating to seed for ${seed.cityLabel}`);
  let pageNum = 1;

  while (pageNum <= MAX_PAGES_PER_SEED) {
    const pageUrl = pageNum === 1 ? seed.seedUrl : `${seed.seedUrl}?page=${pageNum}`;
    await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
    await waitForSearchState(page);

    const { content, totalPages } = await extractPropertyListPage(page);
    log.info(`Seed ${seed.cityLabel} page=${pageNum}/${totalPages || "?"} records=${content.length}`);

    for (const record of content) {
      await processRecord(record, ingest, store, log);
    }

    if (content.length === 0) break;
    if (pageNum >= totalPages) break;
    pageNum += 1;
    await politeWait();
  }
}

export async function runDiscoveryCrawlSpeedhomeKl(
  page: Page,
  ingest: (row: SpeedhomeListingRow) => Promise<void>,
  store: KnownListingsStore,
  log: RunLogger,
): Promise<void> {
  for (const seed of KL_SPEEDHOME_SEEDS) {
    try {
      await runSeedDiscovery(page, seed, ingest, store, log);
    } catch (err) {
      // A page-level failure must not abort the whole run — log it and move to
      // the next seed (same KL PRD §8 resilience philosophy as Mudah.my).
      const reason = err instanceof Error ? err.message : String(err);
      log.failure("(seed)", seed.seedUrl, reason);
    }
    await politeWait();
  }
}

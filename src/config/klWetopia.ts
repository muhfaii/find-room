// KL Wetopia PRD §2: discovery is a flat WordPress REST API enumeration of the
// ENTIRE company catalog, not per-city seed URLs — Wetopia has 20 properties
// company-wide (confirmed live 2026-08-28, comfortably under one page), so
// there is no pagination-per-city concept to replicate here. The PRD still
// asks for defensive `&page=2`-style handling in case the catalog grows past
// one page — see fetchWetopiaListingRefs, which follows WordPress's
// X-WP-TotalPages response header rather than assuming one page is enough.
export const WETOPIA_LISTING_ENDPOINT = "https://wetopia.my/wp-json/wp/v2/listing?per_page=100";

// Headroom against a runaway loop if the header is ever missing/wrong — at
// 100/page this is 5,000 listings, far beyond any plausible growth of a
// 20-property company in the foreseeable future.
const MAX_PAGES = 50;

// State taxonomy ids (confirmed via https://wetopia.my/wp-json/wp/v2/state,
// 2026-08-28): 647 = Kuala Lumpur, 635 = Selangor. Filtering discovery to
// these two is the coarse scope pass; isInKlangValleyScope (against the
// scraped address text) is still the final per-listing scope guard, same
// doctrine as every other KL source — state-level filtering only narrows the
// REST enumeration to "plausibly Klang Valley," not the full 7-city scope
// (Wetopia's own `location` taxonomy has no term at all for Shah Alam, Bangi,
// or Putrajaya — see the PRD's §1 scale/coverage notes).
export const WETOPIA_KLANG_VALLEY_STATE_IDS = [647, 635] as const;

export interface WetopiaListingRef {
  id: number;
  slug: string;
  link: string;
  state: number[];
}

type RawListingRef = { id: number; slug: string; link: string; state?: number[] };

// The REST response's `acf` field is confirmed EMPTY (KL Wetopia PRD §2) —
// this only ever returns id/slug/link/state, never room/price/facility data.
// Follows `X-WP-TotalPages` rather than assuming the catalog always fits in
// one page (KL Wetopia PRD §2's defensive-pagination instruction) — a page
// with zero results also stops the loop, so a missing/malformed header fails
// safe (one page fetched) rather than looping forever.
export async function fetchWetopiaListingRefs(): Promise<WetopiaListingRef[]> {
  const refs: WetopiaListingRef[] = [];
  let pageNum = 1;
  let totalPages = 1;

  while (pageNum <= totalPages && pageNum <= MAX_PAGES) {
    const res = await fetch(`${WETOPIA_LISTING_ENDPOINT}&page=${pageNum}`);
    if (!res.ok) {
      throw new Error(`Wetopia REST API request failed: HTTP ${res.status} (page ${pageNum})`);
    }
    const headerTotalPages = Number(res.headers.get("x-wp-totalpages"));
    if (Number.isFinite(headerTotalPages) && headerTotalPages > 0) totalPages = headerTotalPages;

    const body = (await res.json()) as RawListingRef[];
    if (body.length === 0) break;

    for (const item of body) {
      refs.push({
        id: item.id,
        slug: item.slug,
        link: item.link,
        state: Array.isArray(item.state) ? item.state : [],
      });
    }
    pageNum += 1;
  }

  return refs;
}

export function isKlangValleyState(stateIds: number[]): boolean {
  return stateIds.some((id) => (WETOPIA_KLANG_VALLEY_STATE_IDS as readonly number[]).includes(id));
}

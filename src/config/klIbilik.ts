// KL iBilik PRD §2: two URL shapes depending on administrative level, mirroring
// the same real Malaysian-taxonomy pattern Mudah.my has (state page vs.
// city-within-state page) — but with a further quirk: Putrajaya nests under
// `state=kuala-lumpur` on iBilik, not its own state bucket (confirmed live
// 2026-08-28). The Kuala Lumpur seed here uses the STATE-level aggregate page
// (10,111 results, confirmed matches the room-only `listingTypeCounts.ROOM`
// count exactly) rather than enumerating KL's own sub-districts one by one —
// simpler, and the scope guard still verifies every listing's actual location
// text regardless of which seed surfaced it.
export const KL_IBILIK_SEEDS = [
  { cityLabel: "Kuala Lumpur", seedUrl: "https://www.ibilik.com/locations/malaysia/kuala-lumpur" },
  { cityLabel: "Petaling Jaya", seedUrl: "https://www.ibilik.com/locations/malaysia/selangor/petaling-jaya" },
  { cityLabel: "Ampang Jaya", seedUrl: "https://www.ibilik.com/locations/malaysia/selangor/ampang" },
  { cityLabel: "Subang Jaya", seedUrl: "https://www.ibilik.com/locations/malaysia/selangor/subang-jaya" },
  { cityLabel: "Shah Alam", seedUrl: "https://www.ibilik.com/locations/malaysia/selangor/shah-alam" },
  { cityLabel: "Bangi", seedUrl: "https://www.ibilik.com/locations/malaysia/selangor/bangi" },
  // Confirmed nested under kuala-lumpur, not its own state (KL iBilik PRD §1)
  // — likely already a subset of the Kuala Lumpur seed above, but included
  // explicitly for certainty; discovery is idempotent so any overlap is
  // harmless (deduped by listing_id).
  { cityLabel: "Putrajaya", seedUrl: "https://www.ibilik.com/locations/malaysia/kuala-lumpur/putrajaya" },
] as const;

export type KlIbilikCityLabel = (typeof KL_IBILIK_SEEDS)[number]["cityLabel"];

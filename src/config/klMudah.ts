// The fixed discovery seed list (KL PRD §2, §4): the 7 Klang Valley cities,
// monthly and yearly rentals only. Daily rentals are excluded by Mudah.my's
// "Room For Rent" category itself (categoryId 2100, type=let) — verified live
// on 2026-08-28: every card sampled across the Kuala Lumpur seed page carried
// priceSuffix "per month" and categoryId 2100, so no rental-term filter
// segment/param needs to be appended to the seed URLs.
//
// Slug verification (KL PRD §2 requires an HTTP-200 check, not a 404/redirect):
// this site sits behind Cloudflare bot protection that returns 403/503 to plain
// curl, so the check was done with a real Playwright/Chrome request instead —
// all 7 URLs returned HTTP 200 with a real result-count title on 2026-08-28:
//
//   kuala-lumpur                 -> "3,771 Room For Rent in Kuala Lumpur"
//   selangor-petaling-jaya       -> "478 Room For Rent in Petaling Jaya, Selangor"
//   selangor-ampang              -> "122 Room For Rent in Ampang, Selangor"
//   selangor-subang-jaya         -> "267 Room For Rent in Subang Jaya, Selangor"
//   selangor-shah-alam           -> "834 Room For Rent in Shah Alam, Selangor"
//   selangor-bangi               -> "225 Room For Rent in Bangi, Selangor"
//   putrajaya                    -> "97 Room For Rent in Putrajaya"
//
// Two slug facts that differ from the PRD's "likely candidates":
//   - Petaling Jaya/Subang Jaya/Shah Alam/Bangi/Ampang live under the
//     `selangor-{subarea}` prefix, NOT a bare `{subarea}` slug (bare
//     `petaling-jaya` returns origin-level HTTP 503).
//   - The 7th scope city is "Ampang Jaya" but Mudah.my's slug/label is plain
//     "Ampang" (`selangor-ampang-jaya` falls back to all of Selangor), so the
//     scope guard treats "ampang" as an alias of "Ampang Jaya".
export const KL_MUDAH_SEEDS = [
  {
    cityLabel: "Kuala Lumpur",
    seedUrl: "https://www.mudah.my/kuala-lumpur/rooms-for-rent",
  },
  {
    cityLabel: "Petaling Jaya",
    seedUrl: "https://www.mudah.my/selangor-petaling-jaya/rooms-for-rent",
  },
  {
    cityLabel: "Ampang Jaya",
    seedUrl: "https://www.mudah.my/selangor-ampang/rooms-for-rent",
  },
  {
    cityLabel: "Subang Jaya",
    seedUrl: "https://www.mudah.my/selangor-subang-jaya/rooms-for-rent",
  },
  {
    cityLabel: "Shah Alam",
    seedUrl: "https://www.mudah.my/selangor-shah-alam/rooms-for-rent",
  },
  {
    cityLabel: "Bangi",
    seedUrl: "https://www.mudah.my/selangor-bangi/rooms-for-rent",
  },
  {
    cityLabel: "Putrajaya",
    seedUrl: "https://www.mudah.my/putrajaya/rooms-for-rent",
  },
] as const;

export type KlCityLabel = (typeof KL_MUDAH_SEEDS)[number]["cityLabel"];

// Lowercased city names, matched as substrings against a listing's combined
// location text (e.g. "Cheras, Kuala Lumpur", "Petaling Jaya, Selangor").
// "ampang" is listed deliberately: Mudah.my labels Ampang Jaya listings as
// plain "Ampang" (both a substring match for "Ampang Jaya" and the alias).
const KLANG_VALLEY_CITY_MATCHES = [
  "kuala lumpur",
  "petaling jaya",
  "ampang",
  "subang jaya",
  "shah alam",
  "bangi",
  "putrajaya",
] as const;

// KL PRD §7 scope guard: a listing's raw location text must reference one of
// the 7 target cities, even if it surfaced from a city seed page (cross-promo
// widgets, featured ads, etc. can pull out-of-scope listings — e.g. the PRD's
// §7 note that Penang/Johor results appear on Malaysia-wide pages). Runs on the
// combined "subarea, region" text, which is what Mudah.my renders both at card
// level (initialStore locationLabel) and on the detail page (ad-location).
//
// Substring matching is intentionally lenient ("Bangi" matches "Bangi, Kedah"
// too) — the per-city seed URLs are the primary scope constraint, so a false
// positive here only matters for a cross-promoted out-of-region listing.
// Tighten this if real false positives show up.
export function isInKlangValleyScope(locationRaw: string | null | undefined): boolean {
  if (!locationRaw) return false;
  const normalized = locationRaw.trim().toLowerCase();
  for (const match of KLANG_VALLEY_CITY_MATCHES) {
    if (normalized.includes(match)) return true;
  }
  return false;
}

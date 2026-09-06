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

// The Klang Valley scope guard now lives in ./klangValley.ts — it stopped
// being Mudah.my-specific the moment a second KL source (Speedhome) needed
// the exact same 7-city check. Re-exported here so existing imports of
// `isInKlangValleyScope` from this file keep working unchanged.
export { isInKlangValleyScope } from "./klangValley.js";

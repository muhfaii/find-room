// The Klang Valley scope guard, shared across every KL source (Mudah.my,
// Speedhome, and future sources — KL Speedhome PRD §2: "Ampang Jaya" being
// slugged as plain "Ampang" is a real Malaysian-administrative-naming pattern,
// not a per-source coincidence, and the concept itself — is this listing
// actually in one of our 7 target cities? — is source-agnostic). Extracted out
// of src/config/klMudah.ts (which originally owned this alone, back when
// Mudah.my was the only KL source) so a second source doesn't have to import
// from a file named after the first one.
//
// Lowercased city names, matched as substrings against a listing's combined
// location text (e.g. "Cheras, Kuala Lumpur", "Petaling Jaya, Selangor").
// "ampang" is listed deliberately: both Mudah.my and Speedhome label Ampang
// Jaya listings as plain "Ampang" (both a substring match for "Ampang Jaya"
// and the alias).
const KLANG_VALLEY_CITY_MATCHES = [
  "kuala lumpur",
  "petaling jaya",
  "ampang",
  "subang jaya",
  "shah alam",
  "bangi",
  "putrajaya",
] as const;

// A listing's raw location text must reference one of the 7 target cities,
// even if it surfaced from a city seed page (cross-promo widgets, featured
// ads, etc. can pull out-of-scope listings — confirmed on both Mudah.my, e.g.
// Penang/Johor results on Malaysia-wide pages, and Speedhome, e.g. "Batu
// Caves" listings surfacing on the Kuala Lumpur seed page). Runs on whatever
// combined location text each source can offer — Mudah.my's "subarea, region"
// string, Speedhome's `city` field (or `address` when `city` is null — see KL
// Speedhome PRD §5).
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

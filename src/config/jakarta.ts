// The fixed discovery seed list (PRD §2, §4): the 5 DKI Jakarta administrative
// cities, monthly (`bulanan`) rentals only. Daily (`harian`) rentals are
// explicitly out of scope for this phase. Confirmed via curl (HTTP 200) against
// the live site on 2026-08-02 — all 5 URLs are valid, not 404s/redirects.
//
// The "0-15000000" price-range segment is NOT an artificial cap we chose: widening
// it (e.g. to 0-999999999) causes a 302 redirect to a generic /cari fallback, so
// this appears to be the platform's own max representable price, not a filter that
// excludes real listings.
export const JAKARTA_SEEDS = [
  {
    cityLabel: "Jakarta Pusat",
    seedUrl:
      "https://mamikos.com/cari/jakarta-pusat-kota-jakarta-pusat-daerah-khusus-ibukota-jakarta-indonesia/all/bulanan/0-15000000/99?keyword=Jakarta%20pusat&suggestion_type=search",
  },
  {
    cityLabel: "Jakarta Selatan",
    seedUrl:
      "https://mamikos.com/cari/jakarta-selatan-kota-jakarta-selatan-daerah-khusus-ibukota-jakarta-indonesia/all/bulanan/0-15000000/100?keyword=Jakarta%20Selatan&suggestion_type=search",
  },
  {
    cityLabel: "Jakarta Barat",
    seedUrl:
      "https://mamikos.com/cari/jakarta-barat-kota-jakarta-barat-daerah-khusus-ibukota-jakarta-indonesia/all/bulanan/0-15000000/98?keyword=Jakarta%20Barat&suggestion_type=search",
  },
  {
    cityLabel: "Jakarta Timur",
    seedUrl:
      "https://mamikos.com/cari/jakarta-timur-kota-jakarta-timur-daerah-khusus-ibukota-jakarta-indonesia/all/bulanan/0-15000000/101?keyword=Jakarta%20Timur&suggestion_type=search",
  },
  {
    cityLabel: "Jakarta Utara",
    seedUrl:
      "https://mamikos.com/cari/jakarta-utara-kota-jakarta-utara-daerah-khusus-ibukota-jakarta-indonesia/all/bulanan/0-15000000/102?keyword=Jakarta%20Utara&suggestion_type=search",
  },
] as const;

export type JakartaCityLabel = (typeof JAKARTA_SEEDS)[number]["cityLabel"];

const JAKARTA_CITY_LABELS = new Set<string>(JAKARTA_SEEDS.map((s) => s.cityLabel));

// PRD §4 scope guard: a listing's raw city text must resolve to one of the 5 target
// cities, even if it was surfaced from a Jakarta seed page (cross-promo widgets, etc).
// `cityRaw` is matched case-insensitively against the label since Mamikos' displayed
// text casing isn't guaranteed; tighten this if false positives/negatives show up.
//
// Confirmed in testing on 2026-08-02: window.detail.area_city on a real Jakarta
// Barat listing returned "Kota Jakarta Barat" (with a "Kota " prefix), not the
// bare "Jakarta Barat" label used elsewhere on the site (e.g. the seed URL slugs).
// An exact match alone wrongly rejected a real in-scope listing, so a leading
// "kota " is stripped before comparing.
export function isInJakartaScope(cityRaw: string | null | undefined): boolean {
  if (!cityRaw) return false;
  const normalized = cityRaw.trim().toLowerCase().replace(/^kota\s+/, "");
  for (const label of JAKARTA_CITY_LABELS) {
    if (normalized === label.toLowerCase()) return true;
  }
  return false;
}

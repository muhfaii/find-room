import type { SpeedhomeListingRow, CrawlType } from "../types/klSpeedhomeListing.js";

// KL Speedhome PRD §4: search-result cards and the detail page both embed the
// IDENTICAL structured record shape in window.__NEXT_DATA__ (confirmed live
// 2026-08-28 by comparing a card's fields against its own detail page's
// fields for the same listing — every field checked matched exactly). So one
// extraction function serves both discovery and detail-refresh, unlike
// Mudah.my (lightweight discovery card vs. full detail-page scrape) or
// Mamikos (click-to-learn-URL discovery vs. separate detail extraction).
//
// This is a plain object mapper, not a page.evaluate() DOM reader — the
// caller is responsible for getting the raw JSON record out of the page
// (see discoverySpeedhomeKl.ts / detailRefreshSpeedhomeKl.ts) and passing it
// here. Keeping the mapping logic outside page.evaluate() means it runs in
// Node, not the browser sandbox, and is unit-testable without Playwright.

// Untyped shape of one Speedhome property record — deliberately loose
// (`Record<string, unknown>`-ish) since this is a third party's internal API
// response, not a contract we control. Only the fields this scraper actually
// reads are named.
export interface SpeedhomeRawRecord {
  id: number;
  slug: string;
  name: string;
  type: string; // "ROOM" | "HIGHRISE" | "LANDED"
  roomType: string | null; // "SMALL" | "MEDIUM" | "MASTER"
  bathroomType: string | null; // "SHARED" | "PRIVATE"
  price: number | null;
  city: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  description: string | null;
  status: string | null;
  facilities: string[] | null;
  utilityTypes: string[] | null;
  furnishes: string[] | null;
  images: { imageUrl?: string; url?: string }[] | null;
  securityDeposit: number | null;
  utilitiesDeposit: number | null;
  noDeposit: boolean | null;
  minRentalDuration: number | null;
  propertyTenantPreference: {
    gender?: string | null;
    malaysian?: string | null;
    foreigner?: string | null;
    isMuslim?: boolean | null;
    country?: string[] | null;
    profession?: string | null;
  } | null;
  rating: number | null;
}

// ADR-0004 (KL Speedhome PRD §6): propertyTenantPreference is destructured
// field-by-field, on purpose — never spread, never iterated generically. Only
// `gender` is a legitimate filter concept and is carried separately (see
// gender_restriction_raw below). Everything else here
// (malaysian/foreigner/isMuslim/country/profession — a literal
// religion/nationality-preference record) is turned into a human-readable
// display string via this function alone (KL Speedhome PRD §5/§6: "write a
// human-readable formatter, don't just dump raw JSON at the user"), so there
// is exactly one place in the codebase that touches these fields, making it
// easy to audit that nothing else does.
//
// Only "ALL" has been confirmed as a live value for malaysian/foreigner/
// profession (KL Speedhome PRD §5) — the full enum of restrictive values
// (e.g. what "Malaysians only" actually renders as) is NOT confirmed. Rather
// than invent copy for enum members never observed, any non-"ALL" string is
// humanized generically (snake/camel/upper case -> "Title Case With Spaces")
// instead of pattern-matched against assumed specific values. Revisit this
// once a larger sample confirms the real enum.
function humanize(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function serializeTenantPreferenceRaw(
  pref: SpeedhomeRawRecord["propertyTenantPreference"],
): string | null {
  if (!pref) return null;
  const { malaysian, foreigner, isMuslim, country, profession } = pref;

  const parts: string[] = [];
  if (isMuslim === true) parts.push("Muslim tenants only");
  if (malaysian && malaysian !== "ALL") parts.push(`Malaysian preference: ${humanize(malaysian)}`);
  if (foreigner && foreigner !== "ALL") parts.push(`Foreigner preference: ${humanize(foreigner)}`);
  if (profession && profession !== "ALL") parts.push(`Profession preference: ${humanize(profession)}`);
  if (country && country.length > 0 && !(country.length === 1 && country[0] === "ALL")) {
    parts.push(`Open to: ${country.map(humanize).join(", ")}`);
  }

  return parts.length > 0 ? parts.join("; ") : null; // null — nothing to display beyond gender
}

function toDepositAmountRaw(value: number | null | undefined): string | null {
  return typeof value === "number" ? String(value) : null;
}

function toImageUrls(images: SpeedhomeRawRecord["images"]): string[] | null {
  if (!Array.isArray(images) || images.length === 0) return null;
  const urls = images.map((img) => img.imageUrl ?? img.url).filter((u): u is string => typeof u === "string" && u.length > 0);
  return urls.length > 0 ? urls : null;
}

function mergeAmenities(record: SpeedhomeRawRecord): string[] | null {
  const merged = [...(record.utilityTypes ?? []), ...(record.furnishes ?? [])];
  return merged.length > 0 ? merged : null;
}

// Builds the canonical detail URL from a record's slug (KL Speedhome PRD §2).
export function speedhomeDetailUrl(slug: string): string {
  return `https://speedhome.com/details/${slug}`;
}

// See src/types/klSpeedhomeListing.ts's header comment for the id-prefixing
// rationale (avoiding a listing_id collision with Mudah.my in the shared KL
// D1 table, which upserts on listing_id alone).
export function speedhomeListingId(id: number): string {
  return `speedhome-${id}`;
}

export function extractSpeedhomeFields(
  record: SpeedhomeRawRecord,
  now: string,
  crawlType: CrawlType,
): SpeedhomeListingRow {
  const priceRawText = typeof record.price === "number" ? `RM${record.price} per month` : "";

  return {
    listing_id: speedhomeListingId(record.id),
    source: "speedhome",
    url: speedhomeDetailUrl(record.slug),
    title: record.name ?? "",
    price_amount: typeof record.price === "number" ? record.price : null,
    price_raw_text: priceRawText,
    city_raw: record.city ?? null,
    area_raw: null,
    address_raw: record.address ?? null,
    latitude: typeof record.latitude === "number" ? record.latitude : null,
    longitude: typeof record.longitude === "number" ? record.longitude : null,
    gender_restriction_raw: record.propertyTenantPreference?.gender ?? null,
    room_type_raw: record.roomType ?? null,
    bathroom_type_raw: record.bathroomType ?? null,
    facilities_raw: record.facilities && record.facilities.length > 0 ? record.facilities : null,
    amenities_raw: mergeAmenities(record),
    description_raw: record.description ?? null,
    availability_status_raw: record.status ?? null,
    deposit_amount_raw: toDepositAmountRaw(record.securityDeposit),
    deposit_terms_raw: null, // no free-text deposit-terms concept on this source (KL Speedhome PRD §5)
    refund_conditions_raw: null, // no refund-terms field/concept exists anywhere in Speedhome's schema (KL Speedhome PRD §5)
    tenant_preference_raw: serializeTenantPreferenceRaw(record.propertyTenantPreference),
    no_deposit_program: typeof record.noDeposit === "boolean" ? record.noDeposit : null,
    utilities_deposit_amount: typeof record.utilitiesDeposit === "number" ? record.utilitiesDeposit : null,
    min_rental_duration_months: typeof record.minRentalDuration === "number" ? record.minRentalDuration : null,
    rating: typeof record.rating === "number" ? record.rating : null,
    review_count: null,
    image_urls: toImageUrls(record.images),
    scraped_at: now,
    crawl_type: crawlType,
  };
}

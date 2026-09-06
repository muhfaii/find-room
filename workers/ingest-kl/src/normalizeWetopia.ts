import type { WetopiaListingRow } from "./types.js";
import { computeContentHash, normalizeFacilityTagMy, type KlNormalizedListing, type RoomType } from "./normalize.js";

// The Wetopia half of the KL deployment's normalize step (KL Wetopia PRD §3/
// §7, ADR-0007). A separate module from both Mudah.my's and Speedhome's
// normalize functions — Wetopia's raw shape is DOM-scraped free text like
// Mudah.my's, but with its own price-range format and its own (currently
// always-null) deposit/tenant-preference situation.

// ---- price parsing (range-aware) ----

// Confirmed formats live (KL Wetopia PRD §3): "RM 700 / month" (single value)
// and "RM800 to RM850/ month" (range — takes the lower bound, same convention
// as Mudah.my's range handling). Always monthly in every sample seen; no
// yearly/weekly/daily concept observed on this source.
export function parsePriceWetopia(raw: string): { amount: number | null; period: string | null } {
  const digitMatch = raw.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  const amount = digitMatch ? Number(digitMatch[0]) : null;
  const period = /month/i.test(raw) ? "monthly" : null;
  return { amount: Number.isFinite(amount) ? amount : null, period };
}

// ---- room type enum (KL Wetopia PRD §3) ----

// Confirmed values on the one sampled property: "Master Bedroom", "Medium
// Room", "Small Room" — no "Single Room"/equivalent observed on this source
// (KL Wetopia PRD §3). Per the PRD's explicit caveat, do NOT assume "single"
// is ever produced here — same posture as Speedhome's normalizeSpeedhome.ts,
// which "deliberately never produces 'single'" for the same reason. If a
// future sample confirms a single-room concept on Wetopia, add it then, with
// its own citation — not preemptively based on what a different source's data
// looks like.
const WETOPIA_ROOM_TYPE_PHRASES: { type: RoomType; regex: RegExp }[] = [
  { type: "master", regex: /master/i },
  { type: "middle", regex: /medium/i },
  { type: "small", regex: /small/i },
];

export function normalizeRoomTypeWetopia(raw: string | null): RoomType | null {
  if (!raw) return null;
  for (const { type, regex } of WETOPIA_ROOM_TYPE_PHRASES) {
    if (regex.test(raw)) return type;
  }
  return null;
}

// ---- gender restriction enum ----

// Unconfirmed absence, not confirmed-null (KL Wetopia PRD §3) — always null
// today since gender_restriction_raw is never populated by the scraper yet,
// but routed through a real mapping function (not a raw passthrough) so a
// future confirmed sighting doesn't get written straight into the enum
// column as unmapped free text.
export function normalizeGenderWetopia(raw: string | null): string | null {
  if (!raw) return null;
  if (/female/i.test(raw)) return "female_only";
  if (/male/i.test(raw)) return "male_only";
  if (/mixed|any/i.test(raw)) return "mixed";
  return null;
}

// ---- helpers ----

function jsonOrNull(value: string[] | null): string | null {
  return value === null ? null : JSON.stringify(value);
}

function requiredField(row: WetopiaListingRow, field: keyof WetopiaListingRow, value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${String(field)} is required but got ${JSON.stringify(value)}`);
  }
  return value as string;
}

export async function normalizeListingRowWetopia(row: WetopiaListingRow): Promise<KlNormalizedListing> {
  const listingId = requiredField(row, "listing_id", row.listing_id);
  const url = requiredField(row, "url", row.url);
  const title = requiredField(row, "title", row.title);
  const priceRawText = requiredField(row, "price_amount_raw", row.price_amount_raw);
  const scrapedAt = requiredField(row, "scraped_at", row.scraped_at);

  // KL Wetopia PRD §3: address text is the only location signal this source
  // offers — no separate city/area fields exist. Same non-null-column
  // reasoning as Speedhome's city_raw fallback (normalizeSpeedhome.ts).
  const cityRaw = requiredField(row, "city_raw", row.city_raw ?? row.address_raw);

  const { amount, period } = parsePriceWetopia(priceRawText);
  const roomType = normalizeRoomTypeWetopia(row.room_type_raw);

  // Bed type folds into the facility-tag vocabulary rather than its own
  // column (KL Wetopia PRD §7) — merge it in alongside the room/building/
  // shared-item amenity lists before normalizing tags.
  const allRawFacilities = [
    ...(row.room_amenities_raw ?? []),
    ...(row.building_facilities_raw ?? []),
    ...(row.shared_items_raw ?? []),
    ...(row.bed_type_raw ? [row.bed_type_raw] : []),
  ];
  const normalizedFacilities = allRawFacilities
    .map((f) => normalizeFacilityTagMy(f))
    .filter((tag, i, arr) => arr.indexOf(tag) === i)
    .sort();
  const facilitiesJson = jsonOrNull(normalizedFacilities);
  // No clean building-vs-room split exists in the shared schema for a THIRD
  // amenity list (Wetopia has room amenities, building facilities, AND shared
  // items) — room amenities go in facilities_raw_json, and building
  // facilities + shared items are merged into amenities_raw_json, since
  // "shared items" is conceptually closer to communal/building-level
  // amenities than to the room's own feature list.
  const facilitiesRawJson = jsonOrNull(row.room_amenities_raw);
  const amenitiesRawJson = jsonOrNull(
    [...(row.building_facilities_raw ?? []), ...(row.shared_items_raw ?? [])].length > 0
      ? [...(row.building_facilities_raw ?? []), ...(row.shared_items_raw ?? [])]
      : null,
  );
  const imageUrlsJson = jsonOrNull(row.image_urls);

  const contentHash = await computeContentHash(title, row.description_raw, facilitiesJson ?? "null");

  return {
    listing_id: listingId,
    source: row.source,
    url,
    title,
    price_amount: amount,
    price_period: period,
    price_raw_text: priceRawText,
    price_inclusions_raw: null,
    city_raw: cityRaw,
    area_raw: row.area_raw,
    address_raw: row.address_raw,
    latitude: null,
    longitude: null,
    gender_restriction: normalizeGenderWetopia(row.gender_restriction_raw),
    room_type: roomType,
    room_type_raw: row.room_type_raw,
    facilities_json: facilitiesJson,
    facilities_raw_json: facilitiesRawJson,
    amenities_raw_json: amenitiesRawJson,
    description: row.description_raw,
    availability_status_raw: row.availability_status_raw,
    deposit_amount: null, // no numeric deposit ever found on this source (KL Wetopia PRD §3)
    deposit_amount_raw: row.deposit_amount_raw,
    deposit_terms_raw: row.deposit_terms_raw,
    refund_conditions_raw: row.refund_conditions_raw,
    tenant_preference_raw: row.tenant_preference_raw,
    rating: null,
    review_count: null,
    image_urls_json: imageUrlsJson,
    no_deposit_program: null, // Speedhome-only field, always null for this source
    utilities_deposit_amount: null,
    min_rental_duration_months: null,
    content_hash: contentHash,
    scraped_at: scrapedAt,
    crawl_type: row.crawl_type,
  };
}

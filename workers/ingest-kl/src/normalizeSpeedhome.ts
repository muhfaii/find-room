import type { SpeedhomeListingRow } from "./types.js";
import { computeContentHash, normalizeFacilityTagMy, type KlNormalizedListing, type RoomType } from "./normalize.js";

// The Speedhome half of the KL deployment's normalize step (KL Speedhome PRD
// §5/§6). Deliberately a separate module from normalize.ts's Mudah.my
// functions, even though both produce the same KlNormalizedListing shape and
// share the facility-tag vocabulary/content-hash helpers — the two sources'
// raw shapes have almost nothing else in common (see
// src/types/klSpeedhomeListing.ts's header comment on why most of this is
// direct field copies, not text parsing).

// ---- room type enum (KL Speedhome PRD §5) ----

// Confirmed values across live samples (2026-08-28): SMALL, MEDIUM, MASTER
// only — "SINGLE" was never observed. Do NOT assume SMALL === Mudah.my's
// "single" concept; they may not be the same thing (a small room and a
// single-occupancy room aren't necessarily identical). This mapping
// deliberately never produces "single" for Speedhome rows.
const SPEEDHOME_ROOM_TYPE_MAP: Record<string, RoomType> = {
  SMALL: "small",
  MEDIUM: "middle",
  MASTER: "master",
};

export function normalizeRoomTypeSpeedhome(raw: string | null): RoomType | null {
  if (!raw) return null;
  return SPEEDHOME_ROOM_TYPE_MAP[raw] ?? null;
}

// ---- gender restriction enum ----

// propertyTenantPreference.gender is already a clean typed value
// ("MALE" | "FEMALE" | "ALL") — this is vocabulary translation of an
// unambiguous value onto the shared enum, the same category of work as
// Mudah.my's normalizeGenderMy, not inference over free text.
const SPEEDHOME_GENDER_MAP: Record<string, string> = {
  MALE: "male_only",
  FEMALE: "female_only",
  ALL: "mixed",
};

export function normalizeGenderSpeedhome(raw: string | null): string | null {
  if (!raw) return null;
  return SPEEDHOME_GENDER_MAP[raw] ?? null;
}

// ---- helpers ----

function jsonOrNull(value: string[] | null): string | null {
  return value === null ? null : JSON.stringify(value);
}

function requiredField(row: SpeedhomeListingRow, field: keyof SpeedhomeListingRow, value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${String(field)} is required but got ${JSON.stringify(value)}`);
  }
  return value as string;
}

export async function normalizeListingRowSpeedhome(row: SpeedhomeListingRow): Promise<KlNormalizedListing> {
  const listingId = requiredField(row, "listing_id", row.listing_id);
  const url = requiredField(row, "url", row.url);
  const title = requiredField(row, "title", row.title);
  const priceRawText = requiredField(row, "price_raw_text", row.price_raw_text);
  const scrapedAt = requiredField(row, "scraped_at", row.scraped_at);

  // KL Speedhome PRD §5: `city_raw` is confirmed nullable on this source.
  // KlNormalizedListing.city_raw is non-nullable (shared with Mudah.my, whose
  // city_raw is always present) — falling back to the free-text address here
  // keeps the column truthful (it's genuinely where the listing is) without
  // widening the shared type or the D1 column's NOT NULL constraint for a
  // gap only one of two sources has. A listing with neither is a genuine data
  // anomaly and fails loudly (requiredField), same as any other missing
  // critical field elsewhere in this codebase.
  const cityRaw = requiredField(row, "city_raw", row.city_raw ?? row.address_raw);

  const roomType = normalizeRoomTypeSpeedhome(row.room_type_raw);
  const genderRestriction = normalizeGenderSpeedhome(row.gender_restriction_raw);

  // Merge facilities + amenities (already merged from utilityTypes+furnishes
  // at scrape time — see speedhomeExtract.ts) into the shared tag vocabulary.
  // Reuses Mudah.my's normalizeFacilityTagMy: most of Speedhome's own values
  // are already snake_case (e.g. "kitchen_cabinet"), so the synonym table
  // mostly no-ops for them, but "internet" -> "wifi" and similar synonyms
  // still apply where the vocabularies do overlap.
  const allRawFacilities = [...(row.facilities_raw ?? []), ...(row.amenities_raw ?? [])];
  const normalizedFacilities = allRawFacilities
    .map((f) => normalizeFacilityTagMy(f))
    .filter((tag, i, arr) => arr.indexOf(tag) === i)
    .sort();
  const facilitiesJson = jsonOrNull(normalizedFacilities);
  const facilitiesRawJson = jsonOrNull(row.facilities_raw);
  const amenitiesRawJson = jsonOrNull(row.amenities_raw);
  const imageUrlsJson = jsonOrNull(row.image_urls);

  const contentHash = await computeContentHash(title, row.description_raw, facilitiesJson ?? "null");

  return {
    listing_id: listingId,
    source: row.source,
    url,
    title,
    // KL Speedhome PRD §1/§5: price is already a plain monthly MYR number —
    // no text parsing needed (contrast with Mudah.my's parsePriceMy).
    price_amount: row.price_amount,
    price_period: row.price_amount !== null ? "monthly" : null,
    price_raw_text: priceRawText,
    price_inclusions_raw: null,
    city_raw: cityRaw,
    area_raw: row.area_raw,
    address_raw: row.address_raw,
    latitude: row.latitude,
    longitude: row.longitude,
    gender_restriction: genderRestriction,
    room_type: roomType,
    room_type_raw: row.room_type_raw,
    facilities_json: facilitiesJson,
    facilities_raw_json: facilitiesRawJson,
    amenities_raw_json: amenitiesRawJson,
    description: row.description_raw,
    availability_status_raw: row.availability_status_raw,
    // KL Speedhome PRD §5/ADR-0005: deposit_amount is a direct copy of
    // securityDeposit — NOT reconciled against no_deposit_program, which is
    // carried separately below. Do not treat one as overriding the other.
    deposit_amount: row.deposit_amount_raw ? Number(row.deposit_amount_raw) : null,
    deposit_amount_raw: row.deposit_amount_raw,
    deposit_terms_raw: row.deposit_terms_raw,
    refund_conditions_raw: row.refund_conditions_raw,
    tenant_preference_raw: row.tenant_preference_raw,
    rating: row.rating,
    review_count: row.review_count,
    image_urls_json: imageUrlsJson,
    no_deposit_program: row.no_deposit_program,
    utilities_deposit_amount: row.utilities_deposit_amount,
    min_rental_duration_months: row.min_rental_duration_months,
    content_hash: contentHash,
    scraped_at: scrapedAt,
    crawl_type: row.crawl_type,
  };
}

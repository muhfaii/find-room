import type { KlIbilikListingRow } from "./types.js";
import { computeContentHash, normalizeFacilityTagMy, type KlNormalizedListing, type RoomType } from "./normalize.js";

// The iBilik half of the KL deployment's normalize step (KL iBilik PRD §3-§7,
// ADR-0008). Most fields are direct copies from speedhomeExtract-style typed
// JSON (see src/types/klIbilikListing.ts's header comment) — the real work
// here is the STATUS/LEASE_TERM vocabulary translation ADR-0008 requires.

// ---- room type enum (KL iBilik PRD §4) ----

// Only "SINGLE" and "MASTER" confirmed live — do NOT add MEDIUM/SMALL
// mappings speculatively based on what a different source's enum looks like
// (the same discipline applied to Wetopia's room-type mapping after review:
// don't invent an unconfirmed value just because it seems plausible).
const IBILIK_ROOM_TYPE_MAP: Record<string, RoomType> = {
  SINGLE: "single",
  MASTER: "master",
};

export function normalizeRoomTypeIbilik(raw: string | null): RoomType | null {
  if (!raw) return null;
  return IBILIK_ROOM_TYPE_MAP[raw] ?? null;
}

// ---- gender restriction enum (ADR-0008) ----

// The raw STATUS preference code, verbatim from extractPreferences()
// (ibilikExtract.ts). `couple` maps to `mixed` per ADR-0008 — an accepted
// loss of the specific "couples ok" signal, not an oversight.
const IBILIK_GENDER_MAP: Record<string, string> = {
  "single-female": "female_only",
  "single-male": "male_only",
  couple: "mixed",
};

export function normalizeGenderIbilik(raw: string | null): string | null {
  if (!raw) return null;
  return IBILIK_GENDER_MAP[raw] ?? null;
}

// ---- minimum lease duration (ADR-0008, reuses Speedhome's ADR-0006 column) ----

// "less-than-6-month" has no fixed number to represent — left null rather
// than guessing a placeholder value (KL iBilik PRD §6 / ADR-0008).
const IBILIK_LEASE_TERM_MONTHS: Record<string, number> = {
  "6-month": 6,
  "12-month-and-above": 12,
};

export function normalizeLeaseTermIbilik(raw: string | null): number | null {
  if (!raw) return null;
  return IBILIK_LEASE_TERM_MONTHS[raw] ?? null;
}

// ---- helpers ----

function jsonOrNull(value: string[] | null): string | null {
  return value === null ? null : JSON.stringify(value);
}

function requiredField(row: KlIbilikListingRow, field: keyof KlIbilikListingRow, value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${String(field)} is required but got ${JSON.stringify(value)}`);
  }
  return value as string;
}

export async function normalizeListingRowIbilik(row: KlIbilikListingRow): Promise<KlNormalizedListing> {
  const listingId = requiredField(row, "listing_id", row.listing_id);
  const url = requiredField(row, "url", row.url);
  const title = requiredField(row, "title", row.title);
  const priceRawText = requiredField(row, "price_raw_text", row.price_raw_text);
  const scrapedAt = requiredField(row, "scraped_at", row.scraped_at);

  // KL iBilik PRD §3: city_raw/area_raw come from iBilik's own structured
  // state/city taxonomy (already text, not free-form) — fall back to
  // address_raw only for the rare case both taxonomy fields are missing,
  // same non-null-column reasoning as Speedhome's and Wetopia's city_raw.
  const cityRaw = requiredField(row, "city_raw", row.city_raw ?? row.area_raw ?? row.address_raw);

  const roomType = normalizeRoomTypeIbilik(row.room_type_raw);
  const genderRestriction = normalizeGenderIbilik(row.gender_restriction_raw);
  const minRentalDurationMonths = normalizeLeaseTermIbilik(row.min_rental_duration_raw);

  const normalizedFacilities = (row.facilities_raw ?? [])
    .map((f) => normalizeFacilityTagMy(f))
    .filter((tag, i, arr) => arr.indexOf(tag) === i)
    .sort();
  const facilitiesJson = jsonOrNull(normalizedFacilities);
  const facilitiesRawJson = jsonOrNull(row.facilities_raw);
  const imageUrlsJson = jsonOrNull(row.image_urls);

  const contentHash = await computeContentHash(title, row.description_raw, facilitiesJson ?? "null");

  return {
    listing_id: listingId,
    source: row.source,
    url,
    title,
    // KL iBilik PRD §3: price is already a plain monthly MYR number — no text
    // parsing needed, same as Speedhome.
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
    amenities_raw_json: null, // iBilik has one merged amenity/utility list, not a separate building-vs-room split
    description: row.description_raw,
    availability_status_raw: row.availability_status_raw,
    deposit_amount: row.deposit_amount_raw ? Number(row.deposit_amount_raw) : null,
    deposit_amount_raw: row.deposit_amount_raw,
    deposit_terms_raw: row.deposit_terms_raw,
    refund_conditions_raw: row.refund_conditions_raw,
    tenant_preference_raw: row.tenant_preference_raw,
    rating: row.rating,
    review_count: row.review_count,
    image_urls_json: imageUrlsJson,
    no_deposit_program: null, // Speedhome-only field, always null for this source
    utilities_deposit_amount: null,
    min_rental_duration_months: minRentalDurationMonths,
    content_hash: contentHash,
    scraped_at: scrapedAt,
    crawl_type: row.crawl_type,
  };
}

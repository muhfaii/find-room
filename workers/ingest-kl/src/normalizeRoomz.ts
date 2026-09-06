import type { KlRoomzListingRow } from "./types.js";
import { computeContentHash, normalizeFacilityTagMy, type KlNormalizedListing, type RoomType } from "./normalize.js";

// The Roomz.asia half of the KL deployment's normalize step (KL Roomz PRD
// §3). DOM-scraped free text like Mudah.my/Wetopia — most of the real work
// here is vocabulary translation of already-classified feature strings
// (roomzExtract.ts's classifyFeatureItem already sorted "Male Only" into
// gender_restriction_raw, "Single Room" into room_type_raw, etc. — this
// module only maps those raw strings onto the shared enums/numbers).

// ---- price parsing ----

// Confirmed format: "RM 650.00 / month" — plain decimal, no comma
// thousands-separator seen in samples, but stripped defensively anyway.
export function parsePriceRoomz(raw: string): { amount: number | null; period: string | null } {
  const digitMatch = raw.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  const amount = digitMatch ? Number(digitMatch[0]) : null;
  const period = /month/i.test(raw) ? "monthly" : null;
  return { amount: Number.isFinite(amount) ? amount : null, period };
}

// ---- room type enum ----

// Only "Single Room" was confirmed live on this source (KL Roomz PRD §3) —
// same discipline as every prior source's room-type fix: don't map
// Master/Medium/Small speculatively just because they're common Malaysian
// terms confirmed on OTHER sources. Add them here only once Roomz's own data
// confirms them.
export function normalizeRoomTypeRoomz(raw: string | null): RoomType | null {
  if (!raw) return null;
  return /single/i.test(raw) ? "single" : null;
}

// ---- gender restriction enum ----

export function normalizeGenderRoomz(raw: string | null): string | null {
  if (!raw) return null;
  if (/female/i.test(raw)) return "female_only";
  if (/male/i.test(raw)) return "male_only";
  return null;
}

// ---- lease term (reuses Speedhome's ADR-0006 / iBilik's ADR-0008 column) ----

// "Min. 6 Months Contract" -> 6. No fixed number if the text doesn't parse
// (e.g. an unexpected phrasing) — null, not a guess.
export function normalizeLeaseTermRoomz(raw: string | null): number | null {
  if (!raw) return null;
  const match = raw.match(/(\d+)\s*months?/i);
  return match ? Number(match[1]) : null;
}

// ---- deposit (itemized line items -> total + formatted terms text) ----

export function summarizeDepositRoomz(
  items: { label: string; amountRaw: string }[] | null,
): { amount: number | null; termsRaw: string | null } {
  if (!items || items.length === 0) return { amount: null, termsRaw: null };
  let total = 0;
  let hasAmount = false;
  const parts: string[] = [];
  for (const item of items) {
    const digitMatch = item.amountRaw.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
    if (digitMatch) {
      total += Number(digitMatch[0]);
      hasAmount = true;
    }
    parts.push(`${item.label}: ${item.amountRaw}`);
  }
  return { amount: hasAmount ? total : null, termsRaw: parts.join("; ") };
}

// ---- helpers ----

function jsonOrNull(value: string[] | null): string | null {
  return value === null ? null : JSON.stringify(value);
}

function requiredField(row: KlRoomzListingRow, field: keyof KlRoomzListingRow, value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${String(field)} is required but got ${JSON.stringify(value)}`);
  }
  return value as string;
}

export async function normalizeListingRowRoomz(row: KlRoomzListingRow): Promise<KlNormalizedListing> {
  const listingId = requiredField(row, "listing_id", row.listing_id);
  const url = requiredField(row, "url", row.url);
  const title = requiredField(row, "title", row.title);
  const priceRawText = requiredField(row, "price_raw_text", row.price_raw_text);
  const scrapedAt = requiredField(row, "scraped_at", row.scraped_at);

  // KL Roomz PRD §3: address text ("{area}, {state}") is the only location
  // signal this source offers — same non-null-column reasoning as every
  // other DOM-scraped KL source.
  const cityRaw = requiredField(row, "address_raw", row.address_raw);

  const { amount, period } = parsePriceRoomz(priceRawText);
  const roomType = normalizeRoomTypeRoomz(row.room_type_raw);
  const genderRestriction = normalizeGenderRoomz(row.gender_restriction_raw);
  const minRentalDurationMonths = normalizeLeaseTermRoomz(row.lease_term_raw);
  const { amount: depositAmount, termsRaw: depositTermsRaw } = summarizeDepositRoomz(row.deposit_line_items_raw);

  const allRawFacilities = [
    ...(row.utilities_raw ?? []),
    ...(row.bathroom_type_raw ? [row.bathroom_type_raw] : []),
  ];
  const normalizedFacilities = allRawFacilities
    .map((f) => normalizeFacilityTagMy(f))
    .filter((tag, i, arr) => arr.indexOf(tag) === i)
    .sort();
  const facilitiesJson = jsonOrNull(normalizedFacilities);
  const facilitiesRawJson = jsonOrNull(row.utilities_raw);
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
    area_raw: null,
    address_raw: row.address_raw,
    latitude: null,
    longitude: null,
    gender_restriction: genderRestriction,
    room_type: roomType,
    room_type_raw: row.room_type_raw,
    facilities_json: facilitiesJson,
    facilities_raw_json: facilitiesRawJson,
    amenities_raw_json: null,
    description: row.description_raw,
    availability_status_raw: row.availability_status_raw,
    deposit_amount: depositAmount,
    deposit_amount_raw: row.deposit_line_items_raw ? JSON.stringify(row.deposit_line_items_raw) : null,
    deposit_terms_raw: depositTermsRaw,
    refund_conditions_raw: row.refund_conditions_raw,
    tenant_preference_raw: row.tenant_preference_raw,
    rating: null,
    review_count: null,
    image_urls_json: imageUrlsJson,
    no_deposit_program: null, // Speedhome-only field, always null for this source
    utilities_deposit_amount: null,
    min_rental_duration_months: minRentalDurationMonths,
    content_hash: contentHash,
    scraped_at: scrapedAt,
    crawl_type: row.crawl_type,
  };
}

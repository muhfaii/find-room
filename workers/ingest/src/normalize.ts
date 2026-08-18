import type { ListingRow } from "./types.js";

// The scraping pipeline (src/lib/csv.ts doctrine) deliberately stores raw text
// only — all parsing/normalization happens downstream. This module is that
// downstream step, running inside the ingestion Worker.

export interface NormalizedListing {
  listing_id: string;
  source: string;
  url: string;
  title: string;
  price_amount: number | null;
  price_period: string | null; // 'monthly' | 'daily' | 'yearly' | 'weekly' | null
  price_raw_text: string;
  price_inclusions_raw: string | null;
  city_raw: string;
  area_raw: string | null;
  address_raw: string | null;
  latitude: number | null;
  longitude: number | null;
  gender_restriction: string | null; // 'male_only' | 'female_only' | 'mixed' | null
  room_type_raw: string | null;
  facilities_json: string | null; // JSON array string of normalized tags, e.g. '["ac","wifi"]'
  facilities_raw_json: string | null; // JSON array string of original facilities_raw verbatim
  description: string | null;
  availability_status_raw: string | null;
  rating: number | null;
  review_count: number | null;
  image_urls_json: string | null; // JSON array string of image_urls
  content_hash: string; // sha1 of embedding-source text, for re-embed skip
  scraped_at: string; // ISO 8601, source-of-truth crawl timestamp
  crawl_type: string; // 'discovery' | 'detail_refresh'
}

// ---- price parsing ----

// "Rp4.000.000 /bulan" -> { amount: 4000000, period: "monthly" }.
// Unparseable raw text yields null amount/period — never an error; the raw text
// is always preserved verbatim for display/fallback.
const PRICE_PERIOD_MAP: Record<string, string> = {
  bulan: "monthly",
  hari: "daily",
  minggu: "weekly",
  tahun: "yearly",
};

export function parsePrice(raw: string): { amount: number | null; period: string | null } {
  const periodMatch = raw.toLowerCase().match(/\/(bulan|hari|minggu|tahun)/);
  const period = periodMatch ? (PRICE_PERIOD_MAP[periodMatch[1]] ?? null) : null;

  const lower = raw.toLowerCase();

  // Indonesian magnitude shorthand: "jt"/"juta" = million, "rb"/"ribu" =
  // thousand, e.g. "1.5jt" -> 1500000, "500rb" -> 500000. Checked first because
  // it's unambiguous when present. Range strings like "Rp4jt-6jt" take the
  // first (lower-bound) match.
  const magnitudeMatch = lower.match(/(\d+(?:[.,]\d+)?)\s*(jt|juta|rb|ribu)\b/);
  if (magnitudeMatch) {
    const base = Number(magnitudeMatch[1].replace(",", "."));
    const multiplier = magnitudeMatch[2] === "jt" || magnitudeMatch[2] === "juta" ? 1_000_000 : 1_000;
    const amount = Number.isFinite(base) ? Math.round(base * multiplier) : null;
    return { amount, period };
  }

  // Otherwise assume a plain number with dots as thousands separators
  // ("Rp4.000.000"); strip them and grab the first run of digits.
  const digitMatch = raw.replace(/\./g, "").match(/\d+/);
  const amount = digitMatch ? Number(digitMatch[0]) : null;
  return { amount: Number.isFinite(amount) ? amount : null, period };
}

// ---- facility tag normalization ----

// Small fixed vocabulary of normalized facility tags. Unknown values fall back
// to snake_case(original) so nothing is silently dropped and joins stay usable.
//
// DUPLICATED in workers/chat/src/tools.ts (same const, same name) — the chat
// Worker needs this list too (as the JSON-schema enum constraining which
// facility tags the LLM can filter on), but it's a separate npm/tsconfig
// project from this one with no shared package, same situation as the
// ListingRow type duplication in ./types.ts. If you add/rename/remove a tag
// here, update workers/chat/src/tools.ts's FACILITY_TAGS to match — otherwise
// the chat tool schema and the actual normalized data silently drift apart
// (a tag the LLM can request that nothing is ever tagged with, or vice versa).
export const FACILITY_TAGS = [
  "ac",
  "wifi",
  "private_bathroom",
  "shared_bathroom",
  "parking",
  "laundry",
  "kitchen_access",
  "tv",
  "wardrobe",
  "desk",
  "water_heater",
] as const;

// Lookup keyed by compacted lowercase form (alphanumerics only), mapping
// Indonesian/English synonyms onto the canonical tag vocabulary.
const FACILITY_TAG_SYNONYMS: Record<string, string> = {
  ac: "ac",
  aircon: "ac",
  airconditioner: "ac",
  airconditioning: "ac",
  pendinginudara: "ac",
  wifi: "wifi",
  wifiinternet: "wifi",
  internet: "wifi",
  internetwifi: "wifi",
  privatebathroom: "private_bathroom",
  kamarmandidalam: "private_bathroom",
  kmdidalam: "private_bathroom",
  kmdalam: "private_bathroom",
  kamarmandipribadi: "private_bathroom",
  sharedbathroom: "shared_bathroom",
  kamarmandiluar: "shared_bathroom",
  kmdiluar: "shared_bathroom",
  kmluar: "shared_bathroom",
  kamarmandibersama: "shared_bathroom",
  parking: "parking",
  parkir: "parking",
  parkirmotor: "parking",
  parkirmobil: "parking",
  laundry: "laundry",
  jasalaundry: "laundry",
  mesincuci: "laundry",
  washingmachine: "laundry",
  dapur: "kitchen_access",
  kitchen: "kitchen_access",
  kitchenaccess: "kitchen_access",
  aksesdapur: "kitchen_access",
  dapurbersama: "kitchen_access",
  tv: "tv",
  televisi: "tv",
  television: "tv",
  tvcable: "tv",
  cabletv: "tv",
  kabeltv: "tv",
  lemari: "wardrobe",
  wardrobe: "wardrobe",
  lemaribaju: "wardrobe",
  lemaripakaian: "wardrobe",
  meja: "desk",
  desk: "desk",
  mejabelajar: "desk",
  waterheater: "water_heater",
  pemanasair: "water_heater",
  pemanas: "water_heater",
};

function compact(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function snakeCase(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function normalizeFacilityTag(raw: string): string {
  const key = compact(raw);
  return FACILITY_TAG_SYNONYMS[key] ?? snakeCase(raw);
}

// ---- gender restriction enum ----

// gender_restriction_raw is currently always null from the scraper, but the
// column is defined now and this mapping is ready for when it's populated.
const GENDER_SYNONYMS: Record<string, string> = {
  khususputri: "female_only",
  khususputra: "male_only",
  putri: "female_only",
  putra: "male_only",
  campur: "mixed",
  campuran: "mixed",
  putraputri: "mixed", // "Putra & Putri" — & is stripped by compact()
};

export function normalizeGender(raw: string | null): string | null {
  if (!raw) return null;
  return GENDER_SYNONYMS[compact(raw)] ?? null;
}

// ---- content hash ----

// Reuses the sha1-over-"|"-joined-fields pattern from src/lib/signature.ts, but
// computed inside the Worker via Web Crypto (not node:crypto). Covers the exact
// fields that feed the embedding so an unchanged listing skips re-embedding.
export async function computeContentHash(
  title: string,
  description: string | null,
  sortedFacilitiesJson: string,
): Promise<string> {
  const input = `${title}|${description ?? ""}|${sortedFacilitiesJson}`;
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function jsonOrNull(value: string[] | null): string | null {
  return value === null ? null : JSON.stringify(value);
}

function requiredField(row: ListingRow, field: keyof ListingRow, value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${String(field)} is required but got ${JSON.stringify(value)}`);
  }
  return value as string;
}

export async function normalizeListingRow(row: ListingRow): Promise<NormalizedListing> {
  const listingId = requiredField(row, "listing_id", row.listing_id);
  const url = requiredField(row, "url", row.url);
  const title = requiredField(row, "title", row.title);
  const priceRawText = requiredField(row, "price_raw_text", row.price_raw_text);
  const cityRaw = requiredField(row, "city_raw", row.city_raw);
  const scrapedAt = requiredField(row, "scraped_at", row.scraped_at);

  const { amount, period } = parsePrice(priceRawText);

  const normalizedFacilities = (row.facilities_raw ?? [])
    .map((f) => normalizeFacilityTag(f))
    .filter((tag, i, arr) => arr.indexOf(tag) === i) // dedupe
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
    price_amount: amount,
    price_period: period,
    price_raw_text: priceRawText,
    price_inclusions_raw: row.price_inclusions_raw,
    city_raw: cityRaw,
    area_raw: row.area_raw,
    address_raw: row.address_raw,
    latitude: row.latitude,
    longitude: row.longitude,
    gender_restriction: normalizeGender(row.gender_restriction_raw),
    room_type_raw: row.room_type_raw,
    facilities_json: facilitiesJson,
    facilities_raw_json: facilitiesRawJson,
    description: row.description_raw,
    availability_status_raw: row.availability_status_raw,
    rating: row.rating,
    review_count: row.review_count,
    image_urls_json: imageUrlsJson,
    content_hash: contentHash,
    scraped_at: scrapedAt,
    crawl_type: row.crawl_type,
  };
}

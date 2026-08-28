import type { KlListingRow } from "./types.js";

// The KL deployment's normalize step, running inside the KL ingest Worker. This
// is deliberately a SEPARATE module from workers/ingest/src/normalize.ts
// (ADR-0001/ADR-0002): Jakarta and KL have independent currencies, rental terms,
// and business rules, and are two independent deployments. Only the *concepts*
// are shared — the code is not.

export type RoomType = "single" | "master" | "middle" | "small";

export interface KlNormalizedListing {
  listing_id: string;
  source: string;
  url: string;
  title: string;
  price_amount: number | null;
  price_period: string | null; // 'monthly' | 'yearly' | null — see parsePriceMy for why weekly/daily aren't recognized
  price_raw_text: string;
  price_inclusions_raw: string | null;
  city_raw: string;
  area_raw: string | null;
  address_raw: string | null;
  latitude: number | null;
  longitude: number | null;
  gender_restriction: string | null; // 'male_only' | 'female_only' | 'mixed' | null
  room_type: RoomType | null; // normalized enum, parsed from title/description (KL PRD §5)
  room_type_raw: string | null; // the original matched raw text, kept alongside the enum
  facilities_json: string | null; // JSON array string of normalized tags (ac, wifi, near_transit, ...)
  facilities_raw_json: string | null; // building-level "Facilities" section verbatim
  amenities_raw_json: string | null; // room-level "Amenities" section verbatim
  description: string | null;
  availability_status_raw: string | null;
  deposit_amount: number | null;
  deposit_amount_raw: string | null;
  deposit_terms_raw: string | null;
  refund_conditions_raw: string | null;
  tenant_preference_raw: string | null; // stored + displayed read-only, NEVER filterable (ADR-0004)
  rating: number | null;
  review_count: number | null;
  image_urls_json: string | null;
  content_hash: string; // sha1 of embedding-source text, for re-embed skip
  scraped_at: string;
  crawl_type: string;
}

// ---- price parsing (MYR) ----

// KL PRD §6.3: MYR prices use comma thousands-separators ("RM 1,425 per
// month"), NOT the Indonesian dot-separator / jt / ribu shorthand that
// Jakarta's parsePrice() handles — so it gets its own parser rather than a
// generalized multi-currency one. Unparseable raw text yields null — never an
// error; the raw text is always preserved verbatim for display/fallback.
//
// Only "monthly"/"yearly" are recognized — KL PRD §1 scope. "weekly" was
// dropped entirely: it's never in scope and confirmed live (2026-08-28) to not
// exist as a concept on Mudah.my — the site's Room For Rent filter config
// exposes a single "Rental Price (RM)" range with no period toggle, and no
// listing/config data anywhere contains a rent-period token other than
// "monthly_rent" (the only "year" hits in the full filter config are "Build
// Year" — construction year, unrelated to rent). "daily" is likewise not
// matched — out of scope per the PRD and already excluded at the category
// level (KL PRD §2), so recognizing it here would just be dead surface area.
// "yearly" is kept as a defensive match, not a confirmed one: no live yearly
// listing was found to verify the display text against, since the platform
// has no structured yearly concept at all — this only catches the case where
// an individual landlord free-types "RM X/year" despite no platform support
// for it. If that never happens in practice, this scope decision (KL PRD §1:
// "monthly and yearly") should be revisited for Mudah.my specifically — it
// may only be real for a later KL source with actual annual leases.
export function parsePriceMy(raw: string): { amount: number | null; period: string | null } {
  const lower = raw.toLowerCase();
  let period: string | null = null;
  const periodMatch = lower.match(/(?:per\s+|^|\/|\()(month|year)/);
  if (periodMatch) {
    const map: Record<string, string> = { month: "monthly", year: "yearly" };
    period = map[periodMatch[1]] ?? null;
  }
  if (period === null) {
    const myMap: Record<string, string> = { bulan: "monthly", tahun: "yearly" };
    const myMatch = lower.match(/(bulan|tahun)/);
    if (myMatch) period = myMap[myMatch[1]] ?? null;
  }

  // "RM 1,425" -> 1425, "RM700" -> 700. Strip commas (thousands), then take the
  // first number run. Range strings ("RM 1,000-1,200") take the lower bound.
  const digitMatch = raw.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  const amount = digitMatch ? Number(digitMatch[0]) : null;
  return { amount: Number.isFinite(amount) ? amount : null, period };
}

// ---- room type enum (KL PRD §5/§6.3) ----

// Mudah.my has no structured room-type field — the type appears only inside the
// free-text title/description (e.g. "Middle Room(Female Only)", "Bilik Single",
// "Master Room"). Parse into the normalized enum, keeping the original matched
// text. English AND Malay forms both appear ("Bilik" = room, "Sederhana" =
// medium/middle, "Kecil" = small). When multiple types appear in one title
// (e.g. "BILIK Single Laki Master Toilet"), the earliest match wins — that is
// the room actually being advertised, not the fixture named later.
const ROOM_TYPE_PHRASES: { type: RoomType; regex: RegExp }[] = [
  { type: "single", regex: /\b(?:bilik\s+)?single(?:\s+(?:room|bed))?\b/ },
  { type: "middle", regex: /\b(?:middle|medium)(?:\s+room)?\b|\bbilik\s+(?:sederhana|tengah|medium)\b/ },
  { type: "master", regex: /\bmaster(?:\s+(?:room|bedroom|bilik))?\b|\bbilik\s+(?:master|utama)\b/ },
  { type: "small", regex: /\b(?:small|kecil)(?:\s+room)?\b|\bbilik\s+kecil\b/ },
];

export function parseRoomTypeMy(title: string, description: string | null): { roomType: RoomType | null; raw: string | null } {
  const sources = description ? [title, description] : [title];
  let best: { roomType: RoomType; raw: string } | null = null;
  let bestIndex = -1;

  for (const source of sources) {
    const lower = source.toLowerCase();
    for (const { type, regex } of ROOM_TYPE_PHRASES) {
      const m = regex.exec(lower);
      if (m && (best === null || m.index < bestIndex)) {
        best = { roomType: type, raw: m[0] };
        bestIndex = m.index;
      }
    }
    // Prefer the title signal; only fall back to the description when the title
    // has no room-type phrase at all (descriptions of multi-room listings list
    // several types, making the enum ambiguous).
    if (best !== null) break;
  }

  return best ? { roomType: best.roomType, raw: best.raw } : { roomType: null, raw: null };
}

// ---- deposit terms / refund conditions (best-effort text scans) ----

// Mudah.my has no structured field for either concept — the only signal is
// free text a landlord may write into the description. This is classification
// over raw text, so it belongs here (the normalize step), not in the scraper
// (KL PRD §5/§6.1 raw-field-only doctrine — src/crawlers/detailRefreshKl.ts
// leaves deposit_terms_raw/refund_conditions_raw null at scrape time and
// points here). Both are best-effort: no match yields null, never an error —
// most listings won't mention either explicitly (KL PRD §5: Refund Conditions
// is usually null).
export function extractDepositTermsMy(description: string | null): string | null {
  if (!description) return null;
  const desc = description.replace(/\s+/g, " ");
  const m = desc.match(
    /(?:\d+\s*(?:months?|bulan|month)\s*(?:deposit|advance)|zero\s*deposit|no\s*deposit|tanpa\s*deposit)/i,
  );
  return m ? m[0] : null;
}

export function extractRefundConditionsMy(description: string | null): string | null {
  if (!description) return null;
  const desc = description.replace(/\s+/g, " ");
  const m = desc.match(
    /.{0,60}(?:refund|refundable|dikembalikan|deposit[^.]{0,60}(?:returned|back)|non-refundable).{0,60}/i,
  );
  return m ? m[0].trim() : null;
}

// ---- gender restriction enum ----

// Mudah.my's "Tenant Preference" grid value (samples: "Female", "Male",
// "Male, Female, Couple", "Any") is gender/tenant-type text, not race — KL PRD
// §6.2. Handles the Malay terms seen in titles too ("lelaki" = male,
// "perempuan" = female, "laki" = male). Values containing "couple"/"any" count
// as mixed. Race/religion preferences (if any appear on some listing) return
// null here and are surfaced only through tenant_preference_raw, never the
// gender enum.
const FEMALE_TOKENS = new Set(["female", "perempuan", "wanita", "putri", "puteri", "girls", "ladies"]);
const MALE_TOKENS = new Set(["male", "lelaki", "laki", "putra", "putera", "guys", "boys"]);
const MIXED_TOKENS = new Set(["couple", "any", "mixed", "campur", "campuran", "both", "no", "none"]);

function tokenizeForGender(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length > 0);
}

export function normalizeGenderMy(raw: string | null): string | null {
  if (!raw) return null;
  const tokens = tokenizeForGender(raw);
  let hasFemale = false;
  let hasMale = false;
  for (const t of tokens) {
    if (MIXED_TOKENS.has(t)) return "mixed";
    if (FEMALE_TOKENS.has(t)) hasFemale = true;
    if (MALE_TOKENS.has(t)) hasMale = true;
  }
  if (hasFemale && hasMale) return "mixed";
  if (hasFemale) return "female_only";
  if (hasMale) return "male_only";
  return null;
}

// Fallback gender signal from the free-text title (e.g. "(Female Only)",
// "Female Unit", "(LELAKI)"), used only when the structured Tenant Preference
// field is absent.
export function normalizeGenderFromTitleMy(title: string): string | null {
  const tokens = tokenizeForGender(title);
  let hasFemale = false;
  let hasMale = false;
  for (const t of tokens) {
    if (FEMALE_TOKENS.has(t)) hasFemale = true;
    if (MALE_TOKENS.has(t)) hasMale = true;
  }
  if (hasFemale && hasMale) return "mixed";
  if (hasFemale) return "female_only";
  if (hasMale) return "male_only";
  return null;
}

// ---- facility tag normalization ----

// KL facility vocabulary: Jakarta's 11 tags plus near_transit (the new tag the
// KL PRD §5 flags as needed for "Near KTM/LRT" style amenities). Unknown labels
// fall back to snake_case(original) so nothing is silently dropped and joins
// stay usable.
//
// DUPLICATED in workers/chat-kl/src/tools.ts (same const, same name) — the KL
// chat Worker needs this list too as its tool-schema enum. If you add/rename/
// remove a tag here, update workers/chat-kl/src/tools.ts to match, otherwise
// the chat tool schema and the actual normalized data silently drift apart.
export const FACILITY_TAGS_KL = [
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
  "near_transit",
] as const;

// Lookup keyed by compacted lowercase form (alphanumerics only), mapping
// English/Malay synonyms onto the canonical tag vocabulary.
const FACILITY_TAG_SYNONYMS_KL: Record<string, string> = {
  ac: "ac",
  aircon: "ac",
  aircond: "ac",
  airconditioner: "ac",
  airconditioning: "ac",
  acunit: "ac",
  airconunit: "ac",
  aircondunit: "ac",
  inverter: "ac",
  pendinginudara: "ac",
  wifi: "wifi",
  wifiinternet: "wifi",
  internet: "wifi",
  internetwifi: "wifi",
  wififree: "wifi",
  wifiincluded: "wifi",
  nearktmlrt: "near_transit",
  nearlrt: "near_transit",
  nearmrt: "near_transit",
  nearmrtrlrtktm: "near_transit",
  nearbylrt: "near_transit",
  lrtmrt: "near_transit",
  lrt: "near_transit",
  mrt: "near_transit",
  ktm: "near_transit",
  traintransit: "near_transit",
  nearbytransit: "near_transit",
  nearstation: "near_transit",
  nearmonorail: "near_transit",
  publictransport: "near_transit",
  privatebathroom: "private_bathroom",
  attachedbathroom: "private_bathroom",
  ensuite: "private_bathroom",
  bathroomattached: "private_bathroom",
  kamarmandidalam: "private_bathroom",
  kmdidalam: "private_bathroom",
  kmdalam: "private_bathroom",
  kamarmandipribadi: "private_bathroom",
  sharedbathroom: "shared_bathroom",
  kamarmandiluar: "shared_bathroom",
  kmdiluar: "shared_bathroom",
  kmluar: "shared_bathroom",
  kamarmandibersama: "shared_bathroom",
  commonbathroom: "shared_bathroom",
  parking: "parking",
  parkir: "parking",
  carpark: "parking",
  parkinglot: "parking",
  parkingbay: "parking",
  laundry: "laundry",
  washingmachine: "laundry",
  washer: "laundry",
  mesinbasuh: "laundry",
  laundrymachine: "laundry",
  kitchen: "kitchen_access",
  kitchenaccess: "kitchen_access",
  kitchenette: "kitchen_access",
  dapur: "kitchen_access",
  aksesdapur: "kitchen_access",
  dapurbersama: "kitchen_access",
  cooking: "kitchen_access",
  cookingallowed: "kitchen_access",
  tv: "tv",
  televisi: "tv",
  television: "tv",
  tvcable: "tv",
  cabletv: "tv",
  kabeltv: "tv",
  smarttv: "tv",
  wardrobe: "wardrobe",
  lemari: "wardrobe",
  lemaribaju: "wardrobe",
  lemaripakaian: "wardrobe",
  builtinwardrobe: "wardrobe",
  walkinwardrobe: "wardrobe",
  desk: "desk",
  meja: "desk",
  studytable: "desk",
  studydesk: "desk",
  workdesk: "desk",
  mejabelajar: "desk",
  waterheater: "water_heater",
  heater: "water_heater",
  waterheating: "water_heater",
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

export function normalizeFacilityTagMy(raw: string): string {
  const key = compact(raw);
  return FACILITY_TAG_SYNONYMS_KL[key] ?? snakeCase(raw);
}

// ---- content hash ----

// Reuses the sha1-over-"|"-joined-fields pattern from src/lib/signature.ts,
// computed inside the Worker via Web Crypto. Covers the exact fields that feed
// the embedding so an unchanged listing skips re-embedding.
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

function requiredField(row: KlListingRow, field: keyof KlListingRow, value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${String(field)} is required but got ${JSON.stringify(value)}`);
  }
  return value as string;
}

export async function normalizeListingRowKl(row: KlListingRow): Promise<KlNormalizedListing> {
  const listingId = requiredField(row, "listing_id", row.listing_id);
  const url = requiredField(row, "url", row.url);
  const title = requiredField(row, "title", row.title);
  const priceRawText = requiredField(row, "price_raw_text", row.price_raw_text);
  const cityRaw = requiredField(row, "city_raw", row.city_raw);
  const scrapedAt = requiredField(row, "scraped_at", row.scraped_at);

  const { amount, period } = parsePriceMy(priceRawText);
  const deposit = row.deposit_amount_raw ? parsePriceMy(row.deposit_amount_raw).amount : null;
  const depositTermsRaw = extractDepositTermsMy(row.description_raw);
  const refundConditionsRaw = extractRefundConditionsMy(row.description_raw);

  const { roomType, raw: roomTypeRaw } = parseRoomTypeMy(title, row.description_raw);

  const genderRestriction =
    normalizeGenderMy(row.tenant_preference_raw) ??
    normalizeGenderMy(row.gender_restriction_raw) ??
    normalizeGenderFromTitleMy(title);

  // Fold BOTH raw lists into the normalized tag set (room-level amenities are
  // the primary mapping source per KL PRD §5, but e.g. "Parking" can live in
  // the building-level Facilities list too). The raw lists stay separate below
  // so the Facilities/Amenities distinction is preserved.
  const allRawFacilities = [...(row.facilities_raw ?? []), ...(row.amenities_raw ?? [])];
  const normalizedFacilities = allRawFacilities
    .map((f) => normalizeFacilityTagMy(f))
    .filter((tag, i, arr) => arr.indexOf(tag) === i) // dedupe
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
    price_amount: amount,
    price_period: period,
    price_raw_text: priceRawText,
    price_inclusions_raw: row.price_inclusions_raw,
    city_raw: cityRaw,
    area_raw: row.area_raw,
    address_raw: row.address_raw,
    latitude: row.latitude,
    longitude: row.longitude,
    gender_restriction: genderRestriction,
    room_type: roomType,
    room_type_raw: roomTypeRaw,
    facilities_json: facilitiesJson,
    facilities_raw_json: facilitiesRawJson,
    amenities_raw_json: amenitiesRawJson,
    description: row.description_raw,
    availability_status_raw: row.availability_status_raw,
    deposit_amount: deposit,
    deposit_amount_raw: row.deposit_amount_raw,
    deposit_terms_raw: depositTermsRaw,
    refund_conditions_raw: refundConditionsRaw,
    tenant_preference_raw: row.tenant_preference_raw,
    rating: row.rating,
    review_count: row.review_count,
    image_urls_json: imageUrlsJson,
    content_hash: contentHash,
    scraped_at: scrapedAt,
    crawl_type: row.crawl_type,
  };
}

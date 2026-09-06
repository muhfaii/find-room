import type { KlNormalizedListing } from "./normalize.js";
import type { Env } from "./index.js";

// KL D1 schema (KL PRD §6.4): mirrors the Jakarta LISTING_COLUMNS plus the
// KL-only columns — deposit_amount (+ raw), deposit_terms_raw,
// refund_conditions_raw, tenant_preference_raw, the normalized room_type enum
// (separate from room_type_raw, which both deployments already have), and
// amenities_raw_json (the room-level Amenities section, kept separate from the
// building-level facilities_raw_json per KL PRD §5). no_deposit_program /
// utilities_deposit_amount / min_rental_duration_months are Speedhome-only
// (always null for source='mudah' rows) — see ADR-0005 / ADR-0006 for why
// they're separate columns rather than folded into deposit_amount/price_period.
const LISTING_COLUMNS_KL = [
  "listing_id",
  "source",
  "url",
  "title",
  "price_amount",
  "price_period",
  "price_raw_text",
  "price_inclusions_raw",
  "city_raw",
  "area_raw",
  "address_raw",
  "latitude",
  "longitude",
  "gender_restriction",
  "room_type",
  "room_type_raw",
  "facilities_json",
  "facilities_raw_json",
  "amenities_raw_json",
  "description",
  "availability_status_raw",
  "rating",
  "review_count",
  "image_urls_json",
  "deposit_amount",
  "deposit_amount_raw",
  "deposit_terms_raw",
  "refund_conditions_raw",
  "tenant_preference_raw",
  "no_deposit_program",
  "utilities_deposit_amount",
  "min_rental_duration_months",
  "is_active",
  "content_hash",
  "first_ingested_at",
  "last_refreshed_at",
  "scraped_at",
  "crawl_type",
] as const;

function quotePlaceholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

// Upserts a normalized listing. contentChanged is true when the embedding-source
// content differs from the stored row (or the row is new), which drives the
// re-embed decision. A previously-retired row that is re-ingested also counts
// as changed: /retire deleted its vector, so re-activation must rebuild it even
// when the content hash matches.
//
// content_hash is deliberately NOT advanced here — it stays at the previous
// stored value (or null for a new row) until finalizeContentHash() is called
// after the embed actually succeeds (same failure-recovery rationale as the
// Jakarta worker's db.ts).
export async function upsertListingKl(
  env: Env,
  normalized: KlNormalizedListing,
): Promise<{ contentChanged: boolean }> {
  const existing = await env.DB.prepare(
    "SELECT content_hash, is_active, first_ingested_at FROM listings WHERE listing_id = ?",
  )
    .bind(normalized.listing_id)
    .first<{ content_hash: string | null; is_active: number; first_ingested_at: string }>();

  const now = new Date().toISOString();
  const wasInactive = existing !== null && existing.is_active === 0;
  const contentChanged =
    existing === null || existing.content_hash !== normalized.content_hash || wasInactive;

  const values: (string | number | null)[] = [
    normalized.listing_id,
    normalized.source,
    normalized.url,
    normalized.title,
    normalized.price_amount,
    normalized.price_period,
    normalized.price_raw_text,
    normalized.price_inclusions_raw,
    normalized.city_raw,
    normalized.area_raw,
    normalized.address_raw,
    normalized.latitude,
    normalized.longitude,
    normalized.gender_restriction,
    normalized.room_type,
    normalized.room_type_raw,
    normalized.facilities_json,
    normalized.facilities_raw_json,
    normalized.amenities_raw_json,
    normalized.description,
    normalized.availability_status_raw,
    normalized.rating,
    normalized.review_count,
    normalized.image_urls_json,
    normalized.deposit_amount,
    normalized.deposit_amount_raw,
    normalized.deposit_terms_raw,
    normalized.refund_conditions_raw,
    normalized.tenant_preference_raw,
    normalized.no_deposit_program === null ? null : normalized.no_deposit_program ? 1 : 0,
    normalized.utilities_deposit_amount,
    normalized.min_rental_duration_months,
    1, // is_active — a crawl hit means the listing is live again (re-activation)
    existing?.content_hash ?? null, // held back until finalizeContentHash() confirms the embed succeeded
    existing?.first_ingested_at ?? now, // preserved across re-ingests
    now, // last_refreshed_at
    normalized.scraped_at,
    normalized.crawl_type,
  ];

  const updateSet = LISTING_COLUMNS_KL.filter((col) => col !== "listing_id" && col !== "first_ingested_at")
    .map((col) => `${col} = excluded.${col}`)
    .join(", ");

  const sql = `INSERT INTO listings (${LISTING_COLUMNS_KL.join(", ")})
    VALUES (${quotePlaceholders(LISTING_COLUMNS_KL.length)})
    ON CONFLICT(listing_id) DO UPDATE SET ${updateSet}`;

  await env.DB.prepare(sql).bind(...values).run();

  return { contentChanged };
}

// Advances content_hash to the newly-embedded value. Called only after the
// embed succeeds, so a failed embed never leaves D1 pointing at a hash with no
// matching vector.
export async function finalizeContentHash(env: Env, listingId: string, contentHash: string): Promise<void> {
  await env.DB.prepare("UPDATE listings SET content_hash = ? WHERE listing_id = ?")
    .bind(contentHash, listingId)
    .run();
}

// Soft-deletes a listing (is_active=0, row kept). Returns whether the listing id
// is known at all — /retire is idempotent for unknown/already-retired ids.
export async function retireListingKl(env: Env, listingId: string): Promise<{ found: boolean }> {
  const existing = await env.DB.prepare("SELECT listing_id FROM listings WHERE listing_id = ?")
    .bind(listingId)
    .first();
  if (existing === null) return { found: false };

  await env.DB.prepare("UPDATE listings SET is_active = 0 WHERE listing_id = ?").bind(listingId).run();
  return { found: true };
}

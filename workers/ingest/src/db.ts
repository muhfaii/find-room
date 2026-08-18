import type { NormalizedListing } from "./normalize.js";
import type { Env } from "./index.js";

const LISTING_COLUMNS = [
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
  "room_type_raw",
  "facilities_json",
  "facilities_raw_json",
  "description",
  "availability_status_raw",
  "rating",
  "review_count",
  "image_urls_json",
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
// content differs from the stored row (or the row is new), which is what drives
// the re-embed decision. A previously-retired row that is re-ingested also counts
// as changed: /retire deleted its vector, so re-activation must rebuild it even
// when the content hash matches.
//
// content_hash is deliberately NOT advanced to the new value here — it stays at
// the previous stored value (or null for a new row) until finalizeContentHash()
// is called after the embed actually succeeds. If the embed step throws, the
// stored hash is left stale/null, so the next ingest of identical content will
// still see contentChanged=true and retry the embed, instead of getting
// permanently stuck (the old behavior: hash and vector could silently diverge
// forever after a single transient embed failure).
export async function upsertListing(
  env: Env,
  normalized: NormalizedListing,
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
    normalized.room_type_raw,
    normalized.facilities_json,
    normalized.facilities_raw_json,
    normalized.description,
    normalized.availability_status_raw,
    normalized.rating,
    normalized.review_count,
    normalized.image_urls_json,
    1, // is_active — a crawl hit means the listing is live again (re-activation)
    existing?.content_hash ?? null, // held back until finalizeContentHash() confirms the embed succeeded
    existing?.first_ingested_at ?? now, // preserved across re-ingests
    now, // last_refreshed_at
    normalized.scraped_at,
    normalized.crawl_type,
  ];

  const updateSet = LISTING_COLUMNS.filter((col) => col !== "listing_id" && col !== "first_ingested_at")
    .map((col) => `${col} = excluded.${col}`)
    .join(", ");

  const sql = `INSERT INTO listings (${LISTING_COLUMNS.join(", ")})
    VALUES (${quotePlaceholders(LISTING_COLUMNS.length)})
    ON CONFLICT(listing_id) DO UPDATE SET ${updateSet}`;

  await env.DB.prepare(sql).bind(...values).run();

  return { contentChanged };
}

// Advances content_hash to the newly-embedded value. Called only after
// embedAndUpsertVector() succeeds, so a failed embed never leaves D1 pointing at
// a hash with no matching vector.
export async function finalizeContentHash(env: Env, listingId: string, contentHash: string): Promise<void> {
  await env.DB.prepare("UPDATE listings SET content_hash = ? WHERE listing_id = ?")
    .bind(contentHash, listingId)
    .run();
}

// Soft-deletes a listing (is_active=0, row kept). Returns whether the listing id
// is known at all — /retire is idempotent for unknown/already-retired ids.
export async function retireListing(env: Env, listingId: string): Promise<{ found: boolean }> {
  const existing = await env.DB.prepare("SELECT listing_id FROM listings WHERE listing_id = ?")
    .bind(listingId)
    .first();
  if (existing === null) return { found: false };

  await env.DB.prepare("UPDATE listings SET is_active = 0 WHERE listing_id = ?").bind(listingId).run();
  return { found: true };
}

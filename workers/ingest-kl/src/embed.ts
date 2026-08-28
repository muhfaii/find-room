import type { KlNormalizedListing } from "./normalize.js";
import type { Env } from "./index.js";

// Type alias (not interface) so it's assignable to Record<string, VectorizeVectorMetadata>.
// Nullable fields are omitted at construction — Vectorize metadata values don't
// allow null, and absent keys behave like "no filter" for coarse filtering.
//
// tenant_preference_raw is deliberately EXCLUDED from the metadata: ADR-0004
// requires it to be stored + displayed read-only and never filterable, and
// Vectorize metadata is exactly the coarse-filter surface — leaving it out here
// is the enforcement point for "not even by accident".
export type KlListingVectorMetadata = {
  listing_id: string;
  city_raw: string;
  price_amount?: number;
  gender_restriction?: string;
  is_active: true;
};

const EMBEDDING_MODEL: string = "@cf/baai/bge-m3";
const MAX_EMBEDDING_CHARS = 4000;

// Embedding input text (mirrors the content-hash source fields so unchanged
// listings can skip re-embedding): title, description, then normalized
// facilities. Truncated defensively — embedding models have finite context.
export function buildEmbeddingTextKl(normalized: {
  title: string;
  description: string | null;
  facilities_json: string | null;
}): string {
  const facilities = normalized.facilities_json ?? "[]";
  let text = `${normalized.title}\n${normalized.description ?? ""}\nFasilitas: ${facilities}`;
  if (text.length > MAX_EMBEDDING_CHARS) {
    text = text.slice(0, MAX_EMBEDDING_CHARS);
  }
  return text;
}

// Embeds embeddingText via Workers AI (bge-m3, 1024 dims) and upserts one vector
// keyed by listing_id into the KL Vectorize index, then stamps vector_synced_at.
// Throws on any failure — callers treat that as a row-level ingest error.
export async function embedAndUpsertVector(
  env: Env,
  listingId: string,
  embeddingText: string,
  metadata: KlListingVectorMetadata,
): Promise<void> {
  const run = (await env.AI.run(EMBEDDING_MODEL, {
    text: [embeddingText],
    truncate_inputs: true,
  })) as { data?: number[][] };
  const embedding = run?.data?.[0];
  if (!embedding || embedding.length === 0) {
    throw new Error("Workers AI returned an empty embedding");
  }

  await env.VECTORIZE.upsert([{ id: listingId, values: embedding, metadata }]);

  await env.DB.prepare("UPDATE listings SET vector_synced_at = ? WHERE listing_id = ?")
    .bind(new Date().toISOString(), listingId)
    .run();
}

import { checkAuth } from "./auth.js";
import { finalizeContentHash, retireListingKl, upsertListingKl } from "./db.js";
import { buildEmbeddingTextKl, embedAndUpsertVector, type KlListingVectorMetadata } from "./embed.js";
import { normalizeListingRowKl, type KlNormalizedListing } from "./normalize.js";
import { normalizeListingRowSpeedhome } from "./normalizeSpeedhome.js";
import { normalizeListingRowWetopia } from "./normalizeWetopia.js";
import { normalizeListingRowIbilik } from "./normalizeIbilik.js";
import { normalizeListingRowRoomz } from "./normalizeRoomz.js";
import type { KlAnyListingRow } from "./types.js";

// Dispatches to the matching source's normalize function. Every KL source
// lands in the same D1 table (see schema.sql's header comment) but each has
// its own raw shape and its own normalize module — add a new arm here, never
// widen any individual normalize function itself, when a new KL source is added.
function normalizeRow(row: KlAnyListingRow): Promise<KlNormalizedListing> {
  if (row.source === "speedhome") return normalizeListingRowSpeedhome(row);
  if (row.source === "wetopia") return normalizeListingRowWetopia(row);
  if (row.source === "ibilik") return normalizeListingRowIbilik(row);
  if (row.source === "roomz") return normalizeListingRowRoomz(row);
  return normalizeListingRowKl(row);
}

export interface Env {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  INGEST_SHARED_SECRET: string;
}

const jsonHeaders = { "Content-Type": "application/json" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

interface IngestResult {
  listing_id: string;
  status: "upserted" | "error";
  vector_updated?: boolean;
  error?: string;
}

async function handleIngest(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "malformed JSON body" }, 400);
  }

  if (!body || typeof body !== "object" || !Array.isArray((body as { rows?: unknown }).rows)) {
    return json({ error: "missing required array field: rows" }, 400);
  }
  const rows = (body as { rows: unknown[] }).rows;

  const results: IngestResult[] = [];
  for (const raw of rows) {
    const row = raw as Partial<KlAnyListingRow>;
    const listingId = typeof row?.listing_id === "string" ? row.listing_id : "(unknown)";
    try {
      if (typeof raw !== "object" || raw === null) {
        throw new Error("row is not an object");
      }
      if (
        row.source !== "mudah" &&
        row.source !== "speedhome" &&
        row.source !== "wetopia" &&
        row.source !== "ibilik" &&
        row.source !== "roomz"
      ) {
        throw new Error(`unknown row source: ${JSON.stringify((raw as { source?: unknown }).source)}`);
      }
      const normalized = await normalizeRow(row as KlAnyListingRow);
      const { contentChanged } = await upsertListingKl(env, normalized);

      let vectorUpdated = false;
      if (contentChanged) {
        const embeddingText = buildEmbeddingTextKl(normalized);
        const metadata: KlListingVectorMetadata = {
          listing_id: normalized.listing_id,
          city_raw: normalized.city_raw,
          is_active: true,
        };
        if (normalized.price_amount !== null) metadata.price_amount = normalized.price_amount;
        if (normalized.gender_restriction !== null) metadata.gender_restriction = normalized.gender_restriction;
        await embedAndUpsertVector(env, normalized.listing_id, embeddingText, metadata);
        // Only advance the stored content_hash once the embed has actually
        // landed — see the comment on upsertListingKl() in db.ts.
        await finalizeContentHash(env, normalized.listing_id, normalized.content_hash);
        vectorUpdated = true;
      }

      results.push({ listing_id: listingId, status: "upserted", vector_updated: vectorUpdated });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      results.push({ listing_id: listingId, status: "error", error: reason });
    }
  }

  return json({ results });
}

async function handleRetire(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "malformed JSON body" }, 400);
  }

  const listingId = (body as { listing_id?: unknown } | null)?.listing_id;
  if (typeof listingId !== "string" || listingId.length === 0) {
    return json({ error: "missing required field: listing_id" }, 400);
  }

  try {
    const { found } = await retireListingKl(env, listingId);
    // Idempotent: unknown ids have no vector to remove either; the delete is a
    // harmless orphaned-vector cleanup in both cases.
    await env.VECTORIZE.deleteByIds([listingId]);
    return json({ listing_id: listingId, status: found ? "retired" : "not_found" });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return json({ listing_id: listingId, status: "error", error: reason }, 200);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method !== "POST" || (url.pathname !== "/ingest" && url.pathname !== "/retire")) {
      return json({ error: "not_found" }, 404);
    }

    const authError = checkAuth(request, env);
    if (authError) return authError;

    if (url.pathname === "/ingest") return handleIngest(request, env);
    return handleRetire(request, env);
  },
};

import type { Env } from "./index.js";
import type { SessionFilters } from "./session.js";

// Tool-calling schemas + executors for the chat Worker. Two tools:
//   search_listings_structured — hard D1 filters for concrete criteria.
//   search_listings_semantic   — Vectorize+Workers AI semantic search for vague
//                                preferences, re-verified against D1.
// Vectorize metadata is never treated as the source of truth: after a vector
// query we always re-fetch full rows from D1 by listing_id (authoritative check
// of is_active) before returning them.

export interface ListingHit {
  listing_id: string;
  title: string;
  price_amount: number | null;
  price_period: string | null;
  area_raw: string | null;
  city_raw: string;
  url: string;
  gender_restriction: string | null;
  rating: number | null;
  review_count: number | null;
  image_url: string | null;
  image_urls: string[];
  facilities: string[];
  last_refreshed_at: string | null;
}

export interface ToolResult {
  content: string; // JSON string fed back to the model as the tool response
  listings: ListingHit[];
}

// DUPLICATED in workers/ingest/src/normalize.ts (same const, same name) — this
// is the JSON-schema enum constraining which facility tags the LLM can filter
// on, and must match the tags normalize.ts actually produces. Separate
// npm/tsconfig project from the ingest Worker, no shared package (same
// trade-off as the ListingRow type duplication). If you add/rename/remove a
// tag in normalize.ts, update this list too — otherwise the LLM can request a
// filter tag that nothing is ever normalized to (or vice versa), and that
// facility silently becomes unfilterable.
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

const EMBEDDING_MODEL: string = "@cf/baai/bge-m3";

const HIT_COLUMNS =
  "listing_id, title, price_amount, price_period, area_raw, city_raw, url, gender_restriction, " +
  "rating, review_count, image_urls_json, facilities_json, last_refreshed_at";

type D1Row = Record<string, unknown>;

// Scraped/derived JSON columns aren't guaranteed well-formed — a parse failure
// here shouldn't take down the whole chat turn, so these default to "no data"
// rather than throwing.
function parseImageUrls(json: unknown): string[] {
  if (typeof json !== "string") return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function parseFacilities(json: unknown): string[] {
  if (typeof json !== "string") return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function rowToHit(row: D1Row): ListingHit {
  const imageUrls = parseImageUrls(row.image_urls_json);
  return {
    listing_id: String(row.listing_id ?? ""),
    title: String(row.title ?? ""),
    price_amount: typeof row.price_amount === "number" ? row.price_amount : null,
    price_period: typeof row.price_period === "string" ? row.price_period : null,
    area_raw: typeof row.area_raw === "string" ? row.area_raw : null,
    city_raw: String(row.city_raw ?? ""),
    url: String(row.url ?? ""),
    gender_restriction: typeof row.gender_restriction === "string" ? row.gender_restriction : null,
    rating: typeof row.rating === "number" ? row.rating : null,
    review_count: typeof row.review_count === "number" ? row.review_count : null,
    image_url: imageUrls[0] ?? null,
    image_urls: imageUrls,
    facilities: parseFacilities(row.facilities_json),
    last_refreshed_at: typeof row.last_refreshed_at === "string" ? row.last_refreshed_at : null,
  };
}

// ---- type coercion helpers (tool args arrive as JSON, values are untrusted) ----

export function asInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function clampLimit(value: number | null): number {
  const n = value ?? 10;
  return Math.max(1, Math.min(30, n));
}

const TOOL_FILTER_PROPERTIES: Record<string, unknown> = {
  price_min: { type: "integer", description: "Minimum monthly price in IDR, e.g. 1000000" },
  price_max: { type: "integer", description: "Maximum monthly price in IDR, e.g. 1500000" },
  area: {
    type: "string",
    description: "Area or city name in Indonesian, e.g. 'Depok', 'Jakarta Selatan', 'Menteng'",
  },
  gender_restriction: {
    type: "string",
    enum: ["male_only", "female_only", "mixed"],
    description: "Kost gender restriction: male_only (khusus putra), female_only (khusus putri), mixed (campur)",
  },
  limit: { type: "integer", description: "Maximum number of results, default 10" },
};

const TOOLS: unknown[] = [
  {
    type: "function",
    function: {
      name: "search_listings_structured",
      description:
        "Search kost listings using concrete hard filters. Use when the user gives specific criteria such as budget range, area/city, gender restriction, or required facilities.",
      parameters: {
        type: "object",
        properties: {
          ...TOOL_FILTER_PROPERTIES,
          facilities: {
            type: "array",
            items: { type: "string", enum: FACILITY_TAGS },
            description: "Required facility tags; listings must have all of them",
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_listings_semantic",
      description:
        "Semantic similarity search over kost listings. Use when the user's preferences are freeform or vague (e.g. 'kost yang tenang dan deket kampus UI'), rather than concrete numbers/labels.",
      parameters: {
        type: "object",
        properties: {
          ...TOOL_FILTER_PROPERTIES,
          query_text: {
            type: "string",
            description: "Freeform description of what the user is looking for",
          },
        },
        required: ["query_text"],
        additionalProperties: false,
      },
    },
  },
];

export function getTools(): unknown[] {
  return TOOLS;
}

// ---- filters ----

// Merge persisted session filters under args so a follow-up turn ("yang budget
// 1.5 juta aja") keeps earlier constraints (e.g. area) the user already gave.
export function mergeFilters(
  args: Record<string, unknown>,
  filters: SessionFilters,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...args };
  if (merged.price_min === undefined && filters.priceMin !== undefined) merged.price_min = filters.priceMin;
  if (merged.price_max === undefined && filters.priceMax !== undefined) merged.price_max = filters.priceMax;
  if (merged.area === undefined && filters.area !== undefined) merged.area = filters.area;
  if (merged.gender_restriction === undefined && filters.gender !== undefined) {
    merged.gender_restriction = filters.gender;
  }
  if (merged.facilities === undefined && filters.facilities !== undefined) {
    merged.facilities = filters.facilities;
  }
  return merged;
}

// Extract the filter-shaped args a search tool call made this turn, for
// persisting into session state. Returns only explicitly provided values.
export function argsToFilters(args: Record<string, unknown>): SessionFilters {
  const filters: SessionFilters = {};
  const min = asInt(args.price_min);
  const max = asInt(args.price_max);
  if (min !== null) filters.priceMin = min;
  if (max !== null) filters.priceMax = max;
  const area = asString(args.area);
  if (area) filters.area = area;
  const gender = asString(args.gender_restriction);
  if (gender) filters.gender = gender;
  const facilities = asStringArray(args.facilities);
  if (facilities.length > 0) filters.facilities = facilities;
  return filters;
}

// ---- executors ----

// Shared hard-constraint conditions (price/area/gender/facilities), used both
// to build the structured-search query directly and to re-filter D1 rows after
// a semantic/vector search. Does NOT include is_active, listing_id, ORDER BY, or
// LIMIT — callers add those for their own query shape.
function buildFilterConditions(args: Record<string, unknown>): { conditions: string[]; params: (string | number)[] } {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  const priceMin = asInt(args.price_min);
  const priceMax = asInt(args.price_max);
  if (priceMin !== null) {
    conditions.push("price_amount >= ?");
    params.push(priceMin);
  }
  if (priceMax !== null) {
    conditions.push("price_amount <= ?");
    params.push(priceMax);
  }

  const area = asString(args.area);
  if (area) {
    conditions.push("(area_raw LIKE ? OR city_raw LIKE ?)");
    const like = `%${area}%`;
    params.push(like, like);
  }

  const gender = asString(args.gender_restriction);
  if (gender) {
    conditions.push("gender_restriction = ?");
    params.push(gender);
  }

  for (const tag of asStringArray(args.facilities)) {
    conditions.push("facilities_json LIKE ?");
    params.push(`%"${tag}"%`);
  }

  return { conditions, params };
}

function buildStructuredQuery(
  args: Record<string, unknown>,
): { sql: string; params: (string | number)[] } {
  const { conditions, params } = buildFilterConditions(args);
  conditions.unshift("is_active = 1");
  params.push(clampLimit(asInt(args.limit)));
  const sql = `SELECT ${HIT_COLUMNS} FROM listings WHERE ${conditions.join(" AND ")}
    ORDER BY last_refreshed_at DESC LIMIT ?`;
  return { sql, params };
}

export async function searchListingsStructured(
  env: Env,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const { sql, params } = buildStructuredQuery(args);
  const { results } = await env.DB.prepare(sql).bind(...params).all();
  const listings = (results as D1Row[]).map(rowToHit);
  return { content: JSON.stringify(listings), listings };
}

async function embedQuery(env: Env, text: string): Promise<number[]> {
  const run = (await env.AI.run(EMBEDDING_MODEL, {
    text: [text],
    truncate_inputs: true,
  })) as { data?: number[][] };
  const embedding = run?.data?.[0];
  if (!embedding || embedding.length === 0) {
    throw new Error("Workers AI returned an empty query embedding");
  }
  return embedding;
}

// Coarse pre-filter on Vectorize metadata. Vectorize filters are exact-match
// only, so this is restricted to gender_restriction (a closed enum, safe to
// match exactly). `area` is deliberately NOT filtered here: the tool schema
// lets callers pass area *or* city text (e.g. "Menteng", a district, not a
// city), but the only geo field stored in vector metadata is city_raw — an
// exact-match filter on that would silently drop correct results whenever the
// user's text isn't the literal city name. The D1 re-fetch below (which does a
// LIKE match against both area_raw and city_raw) is the authoritative filter
// for area; this pre-filter is purely an optimization for the fields it's safe
// to narrow on.
function buildVectorFilter(args: Record<string, unknown>): Record<string, string> | undefined {
  const filter: Record<string, string> = {};
  const gender = asString(args.gender_restriction);
  if (gender) filter.gender_restriction = gender;
  return Object.keys(filter).length > 0 ? filter : undefined;
}

export async function searchListingsSemantic(
  env: Env,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const queryText = asString(args.query_text);
  if (!queryText) {
    throw new Error("search_listings_semantic requires query_text");
  }

  const limit = clampLimit(asInt(args.limit));
  const embedding = await embedQuery(env, queryText);

  const filter = buildVectorFilter(args);
  const { matches } = await env.VECTORIZE.query(embedding, {
    topK: limit * 3,
    ...(filter ? { filter } : {}),
  });

  const ids = (matches ?? []).map((m) => m.id);
  if (ids.length === 0) return { content: "[]", listings: [] };

  // Re-apply the full hard-constraint set (price/area/gender/facilities) here —
  // this is the authoritative filter, since the Vectorize pre-filter above only
  // covers gender_restriction. Without this, a query like "quiet, near UI,
  // budget 1.5jt" would ignore the price/area constraints entirely for anything
  // that matched semantically.
  const { conditions, params } = buildFilterConditions(args);
  const placeholders = ids.map(() => "?").join(",");
  const allConditions = [`listing_id IN (${placeholders})`, "is_active = 1", ...conditions];
  const { results } = await env.DB.prepare(
    `SELECT ${HIT_COLUMNS} FROM listings WHERE ${allConditions.join(" AND ")}`,
  )
    .bind(...ids, ...params)
    .all();

  // Preserve vector-similarity ordering; drop inactive/orphaned ids.
  const byId = new Map((results as D1Row[]).map((row) => [String(row.listing_id), row]));
  const rows = ids
    .map((id) => byId.get(id))
    .filter((row): row is D1Row => row !== undefined)
    .slice(0, limit);

  const listings = rows.map(rowToHit);
  return { content: JSON.stringify(listings), listings };
}

export async function executeToolCall(
  env: Env,
  name: string,
  args: Record<string, unknown>,
  filters: SessionFilters,
): Promise<ToolResult> {
  const merged = mergeFilters(args, filters);
  switch (name) {
    case "search_listings_structured":
      return searchListingsStructured(env, merged);
    case "search_listings_semantic":
      return searchListingsSemantic(env, merged);
    default:
      return { content: JSON.stringify({ error: `unknown tool: ${name}` }), listings: [] };
  }
}

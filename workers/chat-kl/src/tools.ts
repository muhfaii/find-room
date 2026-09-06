import type { Env } from "./index.js";
import type { SessionFilters } from "./session.js";

// KL chat Worker tool schemas + executors — the parallel of Jakarta's
// workers/chat/src/tools.ts, against the KL D1/Vectorize. Two tools:
//   search_listings_structured — hard D1 filters for concrete criteria.
//   search_listings_semantic   — Vectorize+Workers AI semantic search.
//
// ADR-0004 is enforced here: tenant_preference_raw is returned in hits (shown
// read-only on the listing card) but is NOT in TOOL_FILTER_PROPERTIES, so the
// model cannot request it as a search/filter parameter. This is the explicit
// "don't wire it up for free" point the KL PRD §6.3 flags.

export interface ListingHit {
  listing_id: string;
  title: string;
  price_amount: number | null;
  price_period: string | null;
  area_raw: string | null;
  city_raw: string;
  url: string;
  gender_restriction: string | null;
  room_type: string | null;
  room_type_raw: string | null;
  deposit_amount: number | null;
  deposit_amount_raw: string | null;
  deposit_terms_raw: string | null;
  refund_conditions_raw: string | null;
  tenant_preference_raw: string | null; // display-only, never filterable (ADR-0004)
  rating: number | null;
  review_count: number | null;
  image_url: string | null;
  image_urls: string[];
  facilities: string[];
  last_refreshed_at: string | null;
  // Speedhome-only (always null for source='mudah' rows) — KL Speedhome PRD §7.
  // Display-only in this pass, same as the rest of the deposit fields; not
  // yet exposed as filter parameters in TOOL_FILTER_PROPERTIES below.
  no_deposit_program: boolean | null;
  utilities_deposit_amount: number | null;
  min_rental_duration_months: number | null;
}

export interface ToolResult {
  content: string; // JSON string fed back to the model as the tool response
  listings: ListingHit[];
}

// DUPLICATED in workers/ingest-kl/src/normalize.ts (same const, same name) —
// this is the JSON-schema enum constraining which facility tags the LLM can
// filter on and must match what normalize.ts actually produces. If you
// add/rename/remove a tag in normalize.ts, update this list too.
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
  "water_included",
  "electricity_included",
  "queen_bed",
  "single_bed",
] as const;

export const ROOM_TYPES_KL = ["single", "master", "middle", "small"] as const;

const EMBEDDING_MODEL: string = "@cf/baai/bge-m3";

const HIT_COLUMNS =
  "listing_id, title, price_amount, price_period, area_raw, city_raw, url, gender_restriction, " +
  "room_type, room_type_raw, deposit_amount, deposit_amount_raw, deposit_terms_raw, refund_conditions_raw, " +
  "tenant_preference_raw, rating, review_count, image_urls_json, facilities_json, last_refreshed_at, " +
  "no_deposit_program, utilities_deposit_amount, min_rental_duration_months";

type D1Row = Record<string, unknown>;

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

function nullableString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
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
    gender_restriction: nullableString(row.gender_restriction),
    room_type: nullableString(row.room_type),
    room_type_raw: nullableString(row.room_type_raw),
    deposit_amount: typeof row.deposit_amount === "number" ? row.deposit_amount : null,
    deposit_amount_raw: nullableString(row.deposit_amount_raw),
    deposit_terms_raw: nullableString(row.deposit_terms_raw),
    refund_conditions_raw: nullableString(row.refund_conditions_raw),
    tenant_preference_raw: nullableString(row.tenant_preference_raw),
    rating: typeof row.rating === "number" ? row.rating : null,
    review_count: typeof row.review_count === "number" ? row.review_count : null,
    image_url: imageUrls[0] ?? null,
    image_urls: imageUrls,
    facilities: parseFacilities(row.facilities_json),
    last_refreshed_at: typeof row.last_refreshed_at === "string" ? row.last_refreshed_at : null,
    no_deposit_program: typeof row.no_deposit_program === "number" ? row.no_deposit_program === 1 : null,
    utilities_deposit_amount: typeof row.utilities_deposit_amount === "number" ? row.utilities_deposit_amount : null,
    min_rental_duration_months:
      typeof row.min_rental_duration_months === "number" ? row.min_rental_duration_months : null,
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

// NOTE: there is deliberately NO tenant_preference property here (ADR-0004).
// room_type IS filterable — it is a physical room attribute, not a protected
// characteristic.
const TOOL_FILTER_PROPERTIES: Record<string, unknown> = {
  price_min: { type: "integer", description: "Minimum monthly price in MYR, e.g. 700" },
  price_max: { type: "integer", description: "Maximum monthly price in MYR, e.g. 1500" },
  area: {
    type: "string",
    description: "Area or city name, e.g. 'Petaling Jaya', 'Cheras', 'Kuala Lumpur'",
  },
  gender_restriction: {
    type: "string",
    enum: ["male_only", "female_only", "mixed"],
    description: "Room gender restriction: male_only (lelaki), female_only (perempuan), mixed (campur)",
  },
  room_type: {
    type: "string",
    enum: [...ROOM_TYPES_KL],
    description: "Normalized room type: single, master, middle, or small room",
  },
  limit: { type: "integer", description: "Maximum number of results, default 10" },
};

const TOOLS: unknown[] = [
  {
    type: "function",
    function: {
      name: "search_listings_structured",
      description:
        "Search room-for-rent listings using concrete hard filters. Use when the user gives specific criteria such as budget range, area, gender restriction, room type, or required facilities.",
      parameters: {
        type: "object",
        properties: {
          ...TOOL_FILTER_PROPERTIES,
          facilities: {
            type: "array",
            items: { type: "string", enum: FACILITY_TAGS_KL },
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
        "Semantic similarity search over room listings. Use when the user's preferences are freeform or vague (e.g. 'bilik tenang dekat LRT'), rather than concrete numbers/labels.",
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

// Merge persisted session filters under args so a follow-up turn keeps earlier
// constraints the user already gave.
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
  if (merged.room_type === undefined && filters.roomType !== undefined) merged.room_type = filters.roomType;
  if (merged.facilities === undefined && filters.facilities !== undefined) {
    merged.facilities = filters.facilities;
  }
  return merged;
}

// Extract the filter-shaped args a search tool call made this turn. Returns
// only explicitly provided values. Never includes tenant_preference (ADR-0004).
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
  const roomType = asString(args.room_type);
  if (roomType) filters.roomType = roomType;
  const facilities = asStringArray(args.facilities);
  if (facilities.length > 0) filters.facilities = facilities;
  return filters;
}

// ---- executors ----

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

  const roomType = asString(args.room_type);
  if (roomType) {
    conditions.push("room_type = ?");
    params.push(roomType);
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

// Coarse pre-filter on Vectorize metadata (exact-match only), restricted to
// gender_restriction — a closed enum, safe to match exactly. area/room_type are
// deliberately NOT filtered here: area is free text and room_type is applied
// authoritatively in the D1 re-fetch below.
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

  // Re-apply the full hard-constraint set (price/area/gender/room_type/
  // facilities) — authoritative, since the Vectorize pre-filter only covers
  // gender_restriction.
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

// KL iBilik ListingRow (KL iBilik PRD §3-§7, ADR-0008). iBilik's backend
// (TanStack Start) exposes fully-typed JSON, closer to Speedhome's situation
// than Mudah.my's free-text one — most fields here are direct copies of
// already-typed values, not raw text awaiting a parser. The exceptions are
// `tenant_preference_raw` (a formatted display string assembled from several
// already-typed preference sub-fields — deterministic templating, not
// inference, same precedent as speedhomeExtract.ts's serializeTenantPreferenceRaw)
// and `gender_restriction_raw`/`min_rental_duration_raw` (kept as the raw
// preference *code*, e.g. "single-female"/"6-month" — the code-to-enum/number
// mapping is vocabulary translation and happens in normalize, not here).
export type CrawlType = "discovery" | "detail_refresh";

export interface KlIbilikListingRow {
  // iBilik's own ids are UUIDs (128-bit, e.g. "019aeae1-e61a-..."), unlike
  // Speedhome's short numeric ids — no collision risk with any other KL
  // source's id scheme, so no "ibilik-" prefix is needed the way
  // speedhomeListingId() prefixes Speedhome's ids (KL iBilik PRD §1).
  listing_id: string;
  source: "ibilik";
  url: string; // https://www.ibilik.com{href} — href is relative in the source data
  title: string;
  price_amount: number | null; // direct copy — already a plain number (KL iBilik PRD §3)
  price_raw_text: string; // synthesized "RM {amount} per {priceUnit}" for display parity with other sources
  city_raw: string | null; // from `state.locales["en-US"].name` (structured taxonomy, not free text — KL iBilik PRD §3)
  area_raw: string | null; // from `area.locales["en-US"].name`
  address_raw: string | null; // the lightweight card's free-text `location` string, used as a scope-guard fallback
  latitude: number | null;
  longitude: number | null;
  room_type_raw: string | null; // longTermRoomRentalListing.roomType verbatim — only "SINGLE"/"MASTER" confirmed live (KL iBilik PRD §4), do not assume others exist
  bathroom_type_raw: string | null; // "SHARED" | "PRIVATE"
  facilities_raw: string[] | null; // merged utilities/amenities list, verbatim labels
  description_raw: string | null;
  availability_status_raw: string | null; // `status` verbatim (e.g. "PUBLISHED")
  deposit_amount_raw: string | null; // from a ratePlans entry whose name suggests a deposit, if one exists (KL iBilik PRD §5) — usually null, not inferred from free text
  deposit_terms_raw: string | null;
  refund_conditions_raw: string | null; // no such concept found on this source
  // ADR-0008: RACE/NATIONALITY/OCCUPATION/GENERAL preference types, formatted
  // into read-only display text — assembled here (deterministic templating
  // over already-typed values, not inference), never a filter/tool-schema
  // parameter downstream.
  tenant_preference_raw: string | null;
  gender_restriction_raw: string | null; // the raw STATUS code verbatim ("single-female" | "single-male" | "couple") — mapped to the enum in normalize (ADR-0008)
  min_rental_duration_raw: string | null; // the raw LEASE_TERM code verbatim ("6-month" | "12-month-and-above" | "less-than-6-month") — parsed to months in normalize (ADR-0008)
  rating: number | null;
  review_count: number | null;
  image_urls: string[] | null;
  scraped_at: string;
  crawl_type: CrawlType;
}

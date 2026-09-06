// KL Speedhome ListingRow (KL Speedhome PRD §5). Deliberately a SEPARATE type
// from KlListingRow (Mudah.my), not a widened union — the two sources' raw
// shapes have almost nothing in common. Speedhome embeds a fully structured,
// already-typed JSON record for every listing (search card and detail page
// both expose the identical shape — confirmed live 2026-08-28), so this type
// mostly holds direct copies of already-typed fields rather than free text
// awaiting a downstream parser.
//
// Doctrine note (KL Speedhome PRD §5): reading an already-typed JSON field
// verbatim is not the same thing as the raw-field-only doctrine's target
// (classification/inference over ambiguous free text, which belongs in
// normalize, not the scraper — see the Mudah.my deposit/refund-terms fix).
// `price_amount = json.price` is a direct copy and belongs here, same as
// `title = json.name`. The exception is `gender_restriction_raw` and
// `tenant_preference_raw` below: those two ARE deferred to normalize, per
// ADR-0004 (§6) — see the field-by-field notes.
export type CrawlType = "discovery" | "detail_refresh";

export interface SpeedhomeListingRow {
  // KL Speedhome PRD §4: Mudah.my and Speedhome ids could theoretically
  // collide (both are small-ish numeric ids from independent counters) and
  // workers/ingest-kl's D1 upsert keys solely on listing_id (no composite key
  // with source) — so every Speedhome id is prefixed "speedhome-" at
  // construction time (see src/crawlers/speedhomeExtract.ts) to guarantee it
  // can never coincide with a bare Mudah.my numeric id. Mudah.my ids stay
  // unprefixed (already shipped; not worth a migration to rename them).
  listing_id: string;
  source: "speedhome";
  url: string; // https://speedhome.com/details/{slug}
  title: string; // name
  price_amount: number | null; // price — already monthly MYR, no text parsing needed (KL Speedhome PRD §1)
  price_raw_text: string; // synthesized "RM {price} per month" for display parity with Mudah.my rows
  city_raw: string | null; // city — CONFIRMED NULLABLE (KL Speedhome PRD §5); scope guard must not treat null as a pass
  area_raw: string | null; // no separate subarea concept observed distinct from `city`; left null
  address_raw: string | null; // address — full free-text string, used as a scope-guard fallback when city_raw is null
  latitude: number | null;
  longitude: number | null;
  // Raw enum string verbatim ("MALE" | "FEMALE" | "ALL") from
  // propertyTenantPreference.gender. Mapping this into the shared
  // male_only/female_only/mixed enum is vocabulary translation of an
  // unambiguous typed value — same category as Mudah.my's normalizeGenderMy —
  // so it happens in normalizeSpeedhome.ts, not here.
  gender_restriction_raw: string | null;
  room_type_raw: string | null; // Speedhome's own enum verbatim: "SMALL" | "MEDIUM" | "MASTER" (no "SINGLE" ever observed — KL Speedhome PRD §5)
  bathroom_type_raw: string | null; // "SHARED" | "PRIVATE" verbatim
  facilities_raw: string[] | null; // `facilities` array verbatim
  amenities_raw: string[] | null; // `utilityTypes` + `furnishes` merged verbatim
  description_raw: string | null;
  availability_status_raw: string | null; // `status` verbatim (e.g. "ACTIVE") — Speedhome has a real structured signal here, unlike Mamikos/Mudah.my
  deposit_amount_raw: string | null; // String(securityDeposit) when not null
  deposit_terms_raw: string | null; // always null — no free-text deposit-terms concept found on this source (KL Speedhome PRD §5)
  refund_conditions_raw: string | null; // always null — no refund-terms field/concept exists anywhere in Speedhome's schema (KL Speedhome PRD §5)
  // ADR-0004: the non-gender parts of propertyTenantPreference
  // (malaysian/foreigner/isMuslim/country/profession — a literal
  // religion/nationality-preference record, not free text), turned into a
  // human-readable display sentence (e.g. "Muslim tenants only; Open to:
  // Southeast Asia, Western") by src/crawlers/speedhomeExtract.ts's
  // serializeTenantPreferenceRaw — the sole place that touches these
  // sub-fields, destructured field-by-field, never spread wholesale (KL
  // Speedhome PRD §6). Stored + displayed read-only; never a filter/tool-schema
  // parameter, same as Mudah.my's tenant_preference_raw.
  tenant_preference_raw: string | null;
  no_deposit_program: boolean | null; // noDeposit verbatim (ADR-0005: NOT assumed to mean deposit_amount is 0)
  utilities_deposit_amount: number | null; // utilitiesDeposit verbatim, kept separate from deposit_amount (ADR-0005)
  min_rental_duration_months: number | null; // minRentalDuration verbatim, months (ADR-0006: not a price_period)
  rating: number | null; // propertyRating — usually null, kept for schema parity
  review_count: number | null; // no direct equivalent observed; always null
  image_urls: string[] | null; // images[].imageUrl verbatim
  scraped_at: string; // ISO 8601 UTC
  crawl_type: CrawlType;
}

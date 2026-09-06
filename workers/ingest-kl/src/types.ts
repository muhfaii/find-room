// Mirrors src/types/klListing.ts — keep in sync manually.
// Workers project is a separate npm/tsconfig project from the Node scraper
// (same trade-off as the Jakarta deployment's type duplication).
export type CrawlType = "discovery" | "detail_refresh";

export interface KlListingRow {
  listing_id: string;
  source: "mudah";
  url: string;
  title: string;
  price_raw_text: string;
  price_inclusions_raw: string | null;
  city_raw: string;
  area_raw: string | null;
  address_raw: string | null;
  latitude: number | null;
  longitude: number | null;
  gender_restriction_raw: string | null;
  room_type_raw: string | null;
  facilities_raw: string[] | null;
  amenities_raw: string[] | null;
  description_raw: string | null;
  availability_status_raw: string | null;
  deposit_amount_raw: string | null;
  deposit_terms_raw: string | null;
  refund_conditions_raw: string | null;
  tenant_preference_raw: string | null;
  rating: number | null;
  review_count: number | null;
  image_urls: string[] | null;
  scraped_at: string; // ISO 8601 UTC
  crawl_type: CrawlType;
}

// Mirrors src/types/klSpeedhomeListing.ts — keep in sync manually. See that
// file's header comment for the raw-field-only doctrine notes specific to
// this source (most fields are direct copies of already-typed values, not
// free text awaiting a parser) and the ADR-0004 destructuring requirement for
// tenant_preference_raw.
export interface SpeedhomeListingRow {
  listing_id: string;
  source: "speedhome";
  url: string;
  title: string;
  price_amount: number | null;
  price_raw_text: string;
  city_raw: string | null;
  area_raw: string | null;
  address_raw: string | null;
  latitude: number | null;
  longitude: number | null;
  gender_restriction_raw: string | null;
  room_type_raw: string | null;
  bathroom_type_raw: string | null;
  facilities_raw: string[] | null;
  amenities_raw: string[] | null;
  description_raw: string | null;
  availability_status_raw: string | null;
  deposit_amount_raw: string | null;
  deposit_terms_raw: string | null;
  refund_conditions_raw: string | null;
  tenant_preference_raw: string | null;
  no_deposit_program: boolean | null;
  utilities_deposit_amount: number | null;
  min_rental_duration_months: number | null;
  rating: number | null;
  review_count: number | null;
  image_urls: string[] | null;
  scraped_at: string;
  crawl_type: CrawlType;
}

// Mirrors src/types/klWetopiaListing.ts — keep in sync manually. ADR-0007:
// listing_id is synthesized (`wetopia-{slug}-room-{n}`) and url is shared
// across every room on the same property — not unique per row, unlike every
// other KL source.
export interface WetopiaListingRow {
  listing_id: string;
  source: "wetopia";
  url: string;
  title: string;
  price_amount_raw: string;
  city_raw: string | null;
  area_raw: string | null;
  address_raw: string | null;
  room_type_raw: string | null;
  bed_type_raw: string | null;
  bathroom_type_raw: string | null;
  room_amenities_raw: string[] | null;
  building_facilities_raw: string[] | null;
  shared_items_raw: string[] | null;
  description_raw: string | null;
  availability_status_raw: string | null;
  deposit_amount_raw: string | null;
  deposit_terms_raw: string | null;
  refund_conditions_raw: string | null;
  tenant_preference_raw: string | null;
  gender_restriction_raw: string | null;
  image_urls: string[] | null;
  scraped_at: string;
  crawl_type: CrawlType;
}

// Mirrors src/types/klIbilikListing.ts — keep in sync manually. ADR-0008:
// tenant_preference_raw is already a formatted display string at scrape time
// (deterministic templating over already-typed preference sub-fields — not
// classification), and no landlord contact/PII fields exist here at all.
export interface KlIbilikListingRow {
  listing_id: string;
  source: "ibilik";
  url: string;
  title: string;
  price_amount: number | null;
  price_raw_text: string;
  city_raw: string | null;
  area_raw: string | null;
  address_raw: string | null;
  latitude: number | null;
  longitude: number | null;
  room_type_raw: string | null;
  bathroom_type_raw: string | null;
  facilities_raw: string[] | null;
  description_raw: string | null;
  availability_status_raw: string | null;
  deposit_amount_raw: string | null;
  deposit_terms_raw: string | null;
  refund_conditions_raw: string | null;
  tenant_preference_raw: string | null;
  gender_restriction_raw: string | null;
  min_rental_duration_raw: string | null;
  rating: number | null;
  review_count: number | null;
  image_urls: string[] | null;
  scraped_at: string;
  crawl_type: CrawlType;
}

// Mirrors src/types/klRoomzListing.ts — keep in sync manually. No landlord
// PII fields exist here at all (same policy as iBilik's ADR-0008).
export interface KlRoomzListingRow {
  listing_id: string;
  source: "roomz";
  url: string;
  title: string;
  price_raw_text: string;
  address_raw: string | null;
  room_type_raw: string | null;
  bathroom_type_raw: string | null;
  lease_term_raw: string | null;
  gender_restriction_raw: string | null;
  occupation_raw: string | null;
  cooking_policy_raw: string | null;
  building_type_raw: string | null;
  furnishing_raw: string | null;
  size_raw: string | null;
  utilities_raw: string[] | null;
  deposit_line_items_raw: { label: string; amountRaw: string }[] | null;
  description_raw: string | null;
  availability_status_raw: string | null;
  refund_conditions_raw: string | null;
  tenant_preference_raw: string | null;
  image_urls: string[] | null;
  scraped_at: string;
  crawl_type: CrawlType;
}

// Mirrors src/types/klAnyListing.ts — the /ingest handler (index.ts)
// dispatches on `row.source` to the matching normalize function.
export type KlAnyListingRow =
  | KlListingRow
  | SpeedhomeListingRow
  | WetopiaListingRow
  | KlIbilikListingRow
  | KlRoomzListingRow;

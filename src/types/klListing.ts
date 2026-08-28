// KL ListingRow — the Kuala Lumpur deployment's parallel to src/types/listing.ts
// (ADR-0002: parallel files per deployment, not one shared union). Mirrors the
// Jakarta `*_raw` doctrine (KL PRD §6.1): all `_raw` fields are captured as
// displayed — no parsing, normalization, or type casting here. That happens in
// the KL ingest worker's normalize step.
//
// KL-specific additions over the Jakarta shape (KL PRD §6.2):
//   - facilities_raw  — the detail page's building-level "Facilities" section
//   - amenities_raw   — the detail page's room/unit-level "Amenities" section
//   - deposit_amount_raw / deposit_terms_raw / refund_conditions_raw
//   - tenant_preference_raw — landlord-stated tenant preference; stored and
//     displayed read-only, NEVER filterable (ADR-0004).
// room_type_raw is null at scrape time (Mudah.my has no structured room-type
// field — it is parsed from title/description downstream, where both room_type
// and the matched raw text are derived). Likewise gender_restriction_raw,
// deposit_terms_raw, and refund_conditions_raw are always null at scrape time —
// Mudah.my has no literal on-page field for any of the three (only free text
// to pattern-match against), and matching text is classification, not verbatim
// capture, so it belongs in the KL ingest worker's normalize step, not here.
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

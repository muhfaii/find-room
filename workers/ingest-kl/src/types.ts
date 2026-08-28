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

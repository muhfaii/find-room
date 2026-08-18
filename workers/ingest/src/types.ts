// Mirrors src/types/listing.ts — keep in sync manually.
// Workers project is a separate npm/tsconfig project from the Node scraper; a
// shared workspace package would be cleaner long-term but is unnecessary scope
// for Phase 1.
export type CrawlType = "discovery" | "detail_refresh";

export interface ListingRow {
  listing_id: string;
  source: "mamikos";
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
  description_raw: string | null;
  availability_status_raw: string | null;
  rating: number | null;
  review_count: number | null;
  image_urls: string[] | null;
  scraped_at: string; // ISO 8601 UTC
  crawl_type: CrawlType;
}

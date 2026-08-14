// Mirrors PRD §5 exactly. All *_raw fields are captured as displayed — no parsing,
// normalization, or type casting here. That happens in a separate downstream step.
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

// Column order for CSV header — must match PRD §5 exactly (§6.1).
export const LISTING_ROW_COLUMNS: (keyof ListingRow)[] = [
  "listing_id",
  "source",
  "url",
  "title",
  "price_raw_text",
  "price_inclusions_raw",
  "city_raw",
  "area_raw",
  "address_raw",
  "latitude",
  "longitude",
  "gender_restriction_raw",
  "room_type_raw",
  "facilities_raw",
  "description_raw",
  "availability_status_raw",
  "rating",
  "review_count",
  "image_urls",
  "scraped_at",
  "crawl_type",
];

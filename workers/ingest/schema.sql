CREATE TABLE IF NOT EXISTS listings (
  listing_id              TEXT PRIMARY KEY,
  source                  TEXT NOT NULL DEFAULT 'mamikos',
  url                     TEXT NOT NULL,
  title                   TEXT NOT NULL,


  -- price, parsed from price_raw_text (e.g. "Rp4.000.000 /bulan")
  price_amount            INTEGER,           -- 4000000 (IDR, integer, nulls allowed if unparseable)
  price_period            TEXT,              -- 'monthly' | 'daily' | 'yearly' | 'weekly' | null (unrecognized)
  price_raw_text          TEXT NOT NULL,     -- always kept verbatim as fallback/display text
  price_inclusions_raw    TEXT,


  city_raw                TEXT NOT NULL,
  area_raw                TEXT,
  address_raw             TEXT,
  latitude                REAL,
  longitude                REAL,


  gender_restriction      TEXT,              -- enum: 'male_only' | 'female_only' | 'mixed' | null (unknown)
  room_type_raw           TEXT,
  facilities_json         TEXT,              -- JSON array string of normalized facility tags, e.g '["ac","wifi","private_bathroom"]'
  facilities_raw_json     TEXT,              -- JSON array string, original facilities_raw verbatim (debug/display)


  description             TEXT,              -- description_raw, kept as embedding source
  availability_status_raw TEXT,
  rating                  REAL,
  review_count            INTEGER,


  image_urls_json         TEXT,              -- JSON array string of image_urls


  is_active               INTEGER NOT NULL DEFAULT 1,  -- 0/1 soft-delete/retirement flag
  content_hash            TEXT,              -- sha1 of embedding-source text (title+description+facilities), for re-embed skip
  vector_synced_at        TEXT,              -- ISO8601, last time Vectorize was successfully updated for this listing


  first_ingested_at       TEXT NOT NULL,     -- ISO8601
  last_refreshed_at       TEXT NOT NULL,     -- ISO8601, updated on every successful /ingest upsert
  scraped_at              TEXT NOT NULL,     -- ISO8601, from ListingRow.scraped_at (source-of-truth crawl timestamp)
  crawl_type              TEXT NOT NULL      -- 'discovery' | 'detail_refresh', last crawl_type that touched this row
);


CREATE INDEX IF NOT EXISTS idx_listings_active ON listings(is_active);
CREATE INDEX IF NOT EXISTS idx_listings_city ON listings(city_raw);
CREATE INDEX IF NOT EXISTS idx_listings_price ON listings(price_amount);
CREATE INDEX IF NOT EXISTS idx_listings_gender ON listings(gender_restriction);

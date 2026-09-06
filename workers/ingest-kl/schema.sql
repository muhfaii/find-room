-- Kuala Lumpur deployment schema (KL PRD §6.4): mirrors the Jakarta listings
-- table plus the KL-only columns. tenant_preference_raw is stored + displayed
-- read-only and must never be added to any filter/searchable schema (ADR-0004).
--
-- One table serves every KL source (Mudah.my, Speedhome, ...) — `source`
-- distinguishes rows, not a separate table per source (ADR-0001 is about
-- country-level deployment separation, not per-source). listing_id is the
-- sole PRIMARY KEY (no composite key with source), so every source's crawler
-- is responsible for keeping its own ids from ever colliding with another
-- source's — see src/types/klSpeedhomeListing.ts for how Speedhome does this
-- (an id prefix) rather than this schema enforcing it.
CREATE TABLE IF NOT EXISTS listings (
  listing_id              TEXT PRIMARY KEY,
  source                  TEXT NOT NULL DEFAULT 'mudah',
  url                     TEXT NOT NULL,
  title                   TEXT NOT NULL,


  -- price, parsed from price_raw_text (e.g. "RM 1,425 per month", "RM 12,000 per year")
  price_amount            INTEGER,           -- 1425 (MYR, integer, nulls allowed if unparseable)
  price_period            TEXT,              -- 'monthly' | 'yearly' | 'weekly' | 'daily' | null
  price_raw_text          TEXT NOT NULL,     -- always kept verbatim as fallback/display text
  price_inclusions_raw    TEXT,


  city_raw                TEXT NOT NULL,     -- region/state text, e.g. "Kuala Lumpur" / "Selangor"
  area_raw                TEXT,              -- subarea text, e.g. "Cheras" / "Petaling Jaya"
  address_raw             TEXT,
  latitude                REAL,
  longitude               REAL,


  gender_restriction      TEXT,              -- enum: 'male_only' | 'female_only' | 'mixed' | null
  room_type               TEXT,              -- normalized enum: 'single' | 'master' | 'middle' | 'small' | null (parsed from title/description, KL PRD §5)
  room_type_raw           TEXT,              -- the original matched raw room-type text (e.g. "Middle Room", "Bilik Single")
  facilities_json         TEXT,              -- JSON array string of normalized tags, e.g '["ac","near_transit","wifi"]'
  facilities_raw_json     TEXT,              -- JSON array string, building-level "Facilities" section verbatim
  amenities_raw_json      TEXT,              -- JSON array string, room-level "Amenities" section verbatim


  description             TEXT,              -- description_raw, kept as embedding source
  availability_status_raw TEXT,
  rating                  REAL,
  review_count            INTEGER,


  image_urls_json         TEXT,              -- JSON array string of image_urls


  -- KL-only deposit/tenant fields (KL PRD §6.2/§6.3)
  deposit_amount          INTEGER,           -- parsed from deposit_amount_raw, e.g. 1425
  deposit_amount_raw      TEXT,              -- e.g. "RM 1,425"
  deposit_terms_raw       TEXT,              -- e.g. "2 months deposit" (free text, often null)
  refund_conditions_raw   TEXT,              -- landlord-stated refund terms (usually null)
  tenant_preference_raw   TEXT,              -- e.g. "Female" / "Male, Female, Couple" — display-only, NEVER filterable

  -- Speedhome-only fields (KL Speedhome PRD §5/§7; always NULL for source='mudah'
  -- rows). Kept as separate columns rather than folded into deposit_amount or
  -- price_period — see ADR-0005 and ADR-0006 for why each one is NOT the field
  -- it superficially resembles.
  no_deposit_program        INTEGER,         -- 0/1/null — Speedhome's "zero-deposit program" flag (ADR-0005: NOT the same claim as deposit_amount being 0)
  utilities_deposit_amount  INTEGER,         -- a second, separate deposit figure (ADR-0005: not summed into deposit_amount)
  min_rental_duration_months INTEGER,        -- minimum lease commitment in months (ADR-0006: NOT a price_period value)


  is_active               INTEGER NOT NULL DEFAULT 1,  -- 0/1 soft-delete/retirement flag
  content_hash            TEXT,              -- sha1 of embedding-source text (title+description+facilities), for re-embed skip
  vector_synced_at        TEXT,              -- ISO8601, last time Vectorize was successfully updated for this listing


  first_ingested_at       TEXT NOT NULL,     -- ISO8601
  last_refreshed_at       TEXT NOT NULL,     -- ISO8601, updated on every successful /ingest upsert
  scraped_at              TEXT NOT NULL,     -- ISO8601, from KlListingRow.scraped_at (source-of-truth crawl timestamp)
  crawl_type              TEXT NOT NULL      -- 'discovery' | 'detail_refresh', last crawl_type that touched this row
);


CREATE INDEX IF NOT EXISTS idx_listings_active ON listings(is_active);
CREATE INDEX IF NOT EXISTS idx_listings_city ON listings(city_raw);
CREATE INDEX IF NOT EXISTS idx_listings_price ON listings(price_amount);
CREATE INDEX IF NOT EXISTS idx_listings_gender ON listings(gender_restriction);
CREATE INDEX IF NOT EXISTS idx_listings_room_type ON listings(room_type);

// KL Wetopia ListingRow (KL Wetopia PRD §3/§7, ADR-0007). Deliberately a
// separate type from every other KL source's row type — the raw-field-only
// doctrine applies here the same way it does for Mudah.my: this is DOM-scraped
// free text (WordPress/Breakdance, no structured JSON blob), not typed JSON
// fields the way Speedhome/iBilik are.
//
// ADR-0007: one row per room, sharing the parent property's URL. listing_id is
// synthesized as `wetopia-{property-slug}-room-{index}` — {index} is the
// room's position in the property page's "Room Options" list at scrape time,
// an accepted fragility if that ordering ever changes (see the ADR).
export type CrawlType = "discovery" | "detail_refresh";

export interface WetopiaListingRow {
  listing_id: string;
  source: "wetopia";
  url: string; // the shared property page URL — NOT unique per row (ADR-0007)
  title: string; // e.g. "Master Room @ Epic Residence" — synthesized from property name + room type, not scraped verbatim as one string
  price_amount_raw: string; // raw text, e.g. "RM 700" or "RM800 to RM850" — range-aware parsing happens in normalize (KL Wetopia PRD §7)
  city_raw: string | null; // from the property's "Location" address text
  area_raw: string | null;
  address_raw: string | null;
  room_type_raw: string | null; // "Master Bedroom" | "Medium Room" | "Small Room" (KL Wetopia PRD §3) — no "single" confirmed yet
  bed_type_raw: string | null; // "Queen Bed" | "Single Bed" — folds into facility tags downstream (KL Wetopia PRD §7), not its own normalized column
  bathroom_type_raw: string | null; // "Private Bathroom" | "Shared Bathroom"
  room_amenities_raw: string[] | null; // per-room amenity list (e.g. "Air Conditioning • Closet / Drawers • Desk / Workspace")
  building_facilities_raw: string[] | null; // property-level "Facilities" section
  shared_items_raw: string[] | null; // property-level "Shared Items" section — a third amenity-style list neither prior source has, folded into amenities downstream
  description_raw: string | null; // property-level description (Wetopia has no per-room description text, only per-property)
  availability_status_raw: string | null; // no signal found on this source (KL Wetopia PRD §3) — always null for now
  deposit_amount_raw: string | null; // confirmed likely-always-null (KL Wetopia PRD §3) — kept for schema parity, not expected to populate
  deposit_terms_raw: string | null; // same as above
  refund_conditions_raw: string | null; // same as above — Wetopia's site-wide refund page is a process form, not a per-listing figure
  tenant_preference_raw: string | null; // UNCONFIRMED absence, not confirmed-null (KL Wetopia PRD §3) — captured if any text is found, expected usually null
  gender_restriction_raw: string | null; // same unconfirmed-absence caveat
  image_urls: string[] | null;
  scraped_at: string;
  crawl_type: CrawlType;
}

// KL Roomz.asia ListingRow (KL Roomz PRD §2/§3). DOM-scraped free text, same
// raw-field-only doctrine as Mudah.my/Wetopia — no window.__NEXT_DATA__ or
// TanStack router state exists on this site. No landlord PII fields exist
// here (name is shown as "Listed by {name}" on cards/detail pages but is
// never captured), same policy as iBilik's ADR-0008, applied here without a
// fresh sign-off since it's an existing decision, not a new one.
export type CrawlType = "discovery" | "detail_refresh";

export interface KlRoomzListingRow {
  listing_id: string; // the {code} segment of /rent/room/{code}/{slug} — short, stable, unique per listing
  source: "roomz";
  url: string;
  title: string;
  price_raw_text: string; // e.g. "RM 650.00 / month"
  address_raw: string | null; // e.g. "Damansara Perdana, Selangor" — the only location signal this source offers
  room_type_raw: string | null; // e.g. "Single Room" (KL Roomz PRD §3)
  bathroom_type_raw: string | null; // "Shared Bathroom" | "Private Bathroom"
  lease_term_raw: string | null; // e.g. "Min. 6 Months Contract"
  gender_restriction_raw: string | null; // "Male Only" | "Female Only" (confirmed both live)
  occupation_raw: string | null; // e.g. "Any Profession" — low-stakes, display-only
  cooking_policy_raw: string | null; // e.g. "Light Cooking"
  building_type_raw: string | null; // e.g. "Condominium" — the catch-all for Features-list items that don't match a more specific category
  furnishing_raw: string | null; // e.g. "Fully Furnished"
  size_raw: string | null; // e.g. "80 Sqft."
  utilities_raw: string[] | null; // the "Utilities" section list
  // Itemized deposit line items (KL Roomz PRD §3: the most granular deposit
  // data of any KL source — a summary figure plus a labeled breakdown table,
  // e.g. "Rental Deposit" + "Access Card Deposit"). Labels are NOT a fixed
  // enum — captured generically as whatever "{label} : {value}" pairs the
  // table actually has, not hardcoded to the two labels observed so far.
  deposit_line_items_raw: { label: string; amountRaw: string }[] | null;
  description_raw: string | null;
  availability_status_raw: string | null; // no signal found on this source
  refund_conditions_raw: string | null; // no per-listing concept found (KL Roomz PRD §3)
  tenant_preference_raw: string | null; // unconfirmed absence, not confirmed-null (KL Roomz PRD §3) — no race/nationality field found in 2 samples
  image_urls: string[] | null;
  scraped_at: string;
  crawl_type: CrawlType;
}

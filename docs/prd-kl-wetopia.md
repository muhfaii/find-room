# PRD: Kuala Lumpur / Klang Valley — Wetopia Scraper (Phase 3 of the KL expansion)

Status: ready for implementation — §4's blocking decision is resolved, see [ADR-0007](adr/0007-wetopia-room-identity-shares-property-url.md). This is source #3 of the KL build order (Mudah.my → Speedhome → **Wetopia** → iBilik → Roomz.asia — see [docs/prd-kl-mudah.md](prd-kl-mudah.md) for why Utopia and BeLive, the original slots #4/#5, were dropped). Written the same way the prior two PRDs were, against the live site — but unlike Mudah.my and Speedhome, this one surfaces a real modeling problem this document does not resolve on its own.

**Read this before assuming Wetopia is "just a smaller Speedhome."** It's the first source without a `window.__NEXT_DATA__`-style structured blob (it's WordPress, not Next.js) — but far more importantly, it's the first source with **no stable per-room URL at all**. Mudah.my and Speedhome both let you say "this exact row is this exact page." Wetopia doesn't.

## §1 — Scope and scale

- **Country/deployment**: same KL deployment as Mudah.my/Speedhome (`source: "wetopia"` in the shared D1 table).
- **Category**: Wetopia is a pure co-living operator — there is no "whole unit vs. room" category split to filter, unlike Speedhome's `type` field. Every listing is rooms in a managed property.
- **Scale, confirmed via the WordPress REST API** (`https://wetopia.my/wp-json/wp/v2/listing?per_page=100`, checked 2026-08-28): **Wetopia's entire company-wide inventory is 20 properties**, across 5 states (Johor, Kuala Lumpur, Negeri Sembilan, Penang, Selangor). Of those 20, **13 are in Kuala Lumpur or Selangor** (state taxonomy ids `647` and `635`, confirmed via `/wp-json/wp/v2/state`). Each property lists roughly 3-6 rooms (the one sampled property, Epic Residence, had 4). That puts the realistic Klang Valley total at **roughly 40-70 room-rows** — an order of magnitude smaller than Speedhome, two orders smaller than Mudah.my. This matches the grilling session's own framing of co-living operators as "small, curated catalogs" — but it's worth having the actual number in front of you before investing in a full scraper for it.
- **Geographic coverage within the 7-city Klang Valley scope is partial**, confirmed via the `location` taxonomy (`/wp-json/wp/v2/location`, 26 terms total): Kuala Lumpur, Petaling Jaya (and PJ-area sub-locations: Kota Damansara, Ara Damansara, Kelana Jaya), Ampang, and Subang Jaya all exist as location terms. **Shah Alam, Bangi, and Putrajaya do not exist as location terms in Wetopia's taxonomy at all** — not "zero properties currently," but the *concept* isn't there, meaning Wetopia likely has no presence in those 3 cities as a matter of where they operate, not a scraping gap.

## §2 — Discovery mechanism: WordPress REST API enumeration, not seed-URL pagination

This is a third, genuinely different discovery pattern from both prior sources:

- Mudah.my: paginate fixed per-city seed URLs.
- Speedhome: paginate fixed per-city seed URLs, reading embedded JSON.
- **Wetopia: one flat enumeration of the entire company catalog** via `GET /wp-json/wp/v2/listing?per_page=100` (20 total results fit in one page — confirm this still holds at implementation time; add `&page=2` handling defensively if the catalog grows past 100). No per-city seed URLs are needed at all.

Each returned object carries `id`, `slug`, `link` (the canonical property page URL), and taxonomy id arrays for `state` and `location` — filter to `state ∈ {635, 647}` (Selangor, Kuala Lumpur) for Klang Valley scope, the same way the other sources' scope guards work, just against taxonomy ids instead of free-text city matching.

**Important negative finding**: the REST API's `acf` field (where Advanced Custom Fields — the actual room list, prices, facilities — would live) is **confirmed empty in the public response** (checked 2026-08-28). The REST API is only useful for *enumerating which properties exist and where they are* — it does not carry any of the field data described in §3. Getting the actual room/price/facility data requires visiting each property's `link` and scraping the rendered page, same as Mudah.my. Don't spend implementation time trying to coax more out of the REST API; it was checked and confirmed not to have it.

## §3 — Field data (from the rendered property page)

Confirmed via a live property page (`https://wetopia.my/listing/epic-residence/`, checked 2026-08-28). The page is built with the Breakdance page builder (WordPress) — expect generated, non-semantic class names similar to Mudah.my's styled-components situation; extraction should key off heading text and structural position (the "Room Options" section, `id="room_options"` on its heading, is one stable anchor), not generated classes.

Confirmed sections and structure:
- **"Details"**: a flat list of building-level features as plain text (e.g. "High Speed Wifi", "Air-Conditioner", "RM150 per Month" — this appears to be a *base/common-area* fee, distinct from any individual room's price; confirm this interpretation against more samples before assuming), "Fully-Furnished Units", "Weekly Cleaning".
- **"Facilities"**: building-level amenities (e.g. "24 Hours Security • BBQ Area • Gymnasium • Sauna • Surau • Swimming Pool") — same bullet-separated format as Mudah.my's Facilities section.
- **"Shared Items"**: a second, distinct list (e.g. "Dining Table • Standing Fan • Washing Machine") — common-area furnishings, not room-specific.
- **"Location"**: full address text, plus a distance-annotated list of nearby landmarks (not needed for the schema, useful context only).
- **"Room Options"**: the actual per-room data, one block per room:
  - A room label ("Room 1", "Room 2", ...) — not a stable id, just a display position.
  - A room-type text that, encouragingly, **maps cleanly onto the existing room_type enum** without Speedhome's ambiguity: confirmed values on the sample were "Master Bedroom", "Medium Room", "Small Room" (→ master/middle/small — no "single" seen here either, same caveat as Speedhome: don't assume single is ever produced by this source until confirmed).
  - A bed type ("Queen Bed", "Single Bed") — a new concept neither prior source has; not in the current schema (see §7).
  - A bathroom type ("Private Bathroom", "Shared Bathroom") — same concept as Speedhome's `bathroomType`, maps to the existing `private_bathroom`/`shared_bathroom` facility tags.
  - A short amenity list per room (e.g. "Air Conditioning • Closet / Drawers • Desk / Workspace").
  - A price, which is sometimes a **single value** ("RM 700 / month") and sometimes a **range** ("RM800 to RM850/ month") — confirmed both forms exist on the same page. Needs a range-aware parser (take the lower bound, same convention as Mudah.my's range handling), genuinely different from both prior sources' single-value price parsing.

**Confirmed missing, not yet found anywhere**:
- **Deposit amount**: not shown on the sampled listing at all. Wetopia has a site-wide "Refund Deposit" page (`https://wetopia.my/refund-deposit/`), but it's a **post-move-out refund request form** ("Property / Unit Stayed", bank details, supporting documents) — it explains the refund *process*, not what any given room's deposit *amount* is. It's plausible Wetopia simply doesn't disclose deposit figures publicly (common for a company that fronts the deposit as part of its "all-inclusive" pitch) and only reveals it during the booking conversation. Treat `deposit_amount_raw`/`deposit_terms_raw` as **likely always null** for this source until a listing is found that contradicts this — don't build normalize-step logic assuming a value will usually be there.
- **Tenant/gender preference**: no field or text resembling this was found anywhere on the sampled listing. Unconfirmed whether this is because Wetopia genuinely doesn't publish it, or because the one property sampled happens not to have a gender-restricted room. Check a larger sample before concluding `tenant_preference_raw`/`gender_restriction_raw` should always be null — this is a real unknown, not a confirmed absence the way deposit terms are for Speedhome.
- **Refund conditions**: same situation as deposit amount — the site-wide refund page describes a *process* (45-90 working days, verification steps), not per-listing terms. Not a per-listing field.

## §4 — Resolved: one row per room, sharing the property's URL

Confirmed live: **every room's "Book Now" button on a property page links to the exact same generic contact page** (`https://wetopia.my/letschathere`), regardless of which room it's under. There is no per-room anchor, query param, id, or any other distinguishing URL anywhere in the DOM. The *property* has a stable URL (`/listing/{slug}/`); an individual *room within it* does not.

**Decision ([ADR-0007](adr/0007-wetopia-room-identity-shares-property-url.md)): one row per room, sharing the property's URL.** Synthesize `listing_id` as `wetopia-{property-slug}-room-{n}` (`{n}` is the room's position in the page's "Room Options" list at scrape time — an accepted, index-based fragility if that ordering ever changes between scrapes, not something to solve with false precision the source doesn't offer) and set every room's `url` to the same property page. A user who clicks through from a specific room the chat recommended lands on a page showing *all* rooms in that property, not the one discussed — surface this honestly in chat/UI copy rather than implying a direct link.

## §5 — Compliance

robots.txt (`https://wetopia.my/robots.txt`, checked 2026-08-28): `Disallow: /wp-admin/`, `Allow: /wp-admin/admin-ajax.php`, no Crawl-delay. Neither `/wp-json/wp/v2/listing` nor `/listing/{slug}/` is disallowed. Reuse the default 3-7s politeness window and `fetchRobotsRules("https://wetopia.my")`, same pattern as the other two sources.

## §6 — Resilience / retirement / resumability

The usual per-listing failure/retirement/resumability patterns apply once §4 is resolved and there's a real per-row identity to track failures against. Not otherwise different from the other two sources.

## §7 — Schema notes

- **Bed type** (`"Queen Bed"` / `"Single Bed"`) folds into the existing facility-tag vocabulary as `queen_bed`/`single_bed` — a small, closed, recurring enum, the same category of case that justified Speedhome's `water_included`/`electricity_included` tags (see [workers/ingest-kl/src/normalize.ts](../workers/ingest-kl/src/normalize.ts)'s header comment on when a new tag is warranted vs. left to the unknown-label fallback). Not its own column — unlike `min_rental_duration_months` (ADR-0006), bed type doesn't carry the same "different concept entirely from anything filterable today" weight; it's a facility distinction, not a new axis of the schema.
- **Price ranges** need their own parsing convention (lower-bound extraction, same as Mudah.my's existing range handling) — not a new architectural question, just a reminder it's genuinely two different price shapes on this one source.

## §8 — Explicitly out of scope for this PRD

- iBilik, Roomz.asia — separate PRDs, same live-verification standard as this one.
- Confirming whether tenant/gender preference exists anywhere on this source — flagged as unconfirmed, not resolved.
- Singapore, cross-country search/unification — unchanged from the other KL PRDs.

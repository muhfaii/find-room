# PRD: Kuala Lumpur / Klang Valley — Mudah.my Scraper (Phase 1 of the KL expansion)

Status: ready for implementation. This is source #1 of the KL build order agreed in [ADR-0001](adr/0001-separate-deployment-per-country.md) / [ADR-0002](adr/0002-same-repo-parallel-structure.md) (Mudah.my → Speedhome → Wetopia → iBilik → Roomz.asia). This document only specifies Mudah.my; each later source gets its own PRD once its DOM/data has been confirmed the same way this one was.

Utopia Co-living and BeLive, originally slots #4 and #5, were dropped after live verification: Utopia has no browsable listing catalog anywhere on its site (pure WhatsApp-concierge lead-gen, no prices/rooms/addresses to scrape), and BeLive's robots.txt explicitly disallows ClaudeBot by name (alongside GPTBot, CCBot, Google-Extended, and others) — the same stated AI-crawler opt-out that already excluded Komune Living from this list. Neither is a scoping judgment call; both are confirmed facts about the live sites.

Cross-reference: the existing Jakarta/Mamikos PRD is cited throughout the codebase as "PRD §N" (see [src/config/jakarta.ts](../src/config/jakarta.ts), [src/config/politeness.ts](../src/config/politeness.ts)). This document uses the same "§N" convention so new code comments can cite it the same way, but it is a **separate PRD for a separate deployment** — not an amendment to the Jakarta one.

## §1 — Scope

- **Country/deployment**: Malaysia — Kuala Lumpur / Klang Valley, deployed independently from Jakarta (own D1 database, own chat worker, reachable at `findrooms.app/kl/*` via Worker Routes — [ADR-0003](adr/0003-worker-routes-split-per-country.md)).
- **Source**: Mudah.my only, for this phase.
- **Rental term**: monthly and yearly are both in scope for the Kuala Lumpur *deployment* (diverges from Jakarta's monthly-only rule — intentional, see [CONTEXT.md](../CONTEXT.md) "Rental Term"). **For Mudah.my specifically, this source is monthly-only in practice** — confirmed live 2026-08-28 via the site's own filter config: the price field is labeled plainly "Rental Price (RM)" with no period toggle, the only period-shaped key anywhere in the config or search-result data is `monthly_rent`, and the only "year" occurrences are `Build Year` (construction year, unrelated to rent). There is no structured yearly-rental concept on this site to scrape. `parsePriceMy` ([workers/ingest-kl/src/normalize.ts](../workers/ingest-kl/src/normalize.ts)) keeps a defensive (not confirmed) match for a landlord free-typing "RM X/year" despite no platform support for it, but yearly should be treated as effectively unused for this source. The "monthly and yearly" deployment-level scope is expected to become real once a later KL source with actual annual leases is added (§9).
- **Category**: Mudah.my's "Room For Rent" category only (categoryId `2100`, confirmed via `initialStore` — see §4). Do not crawl whole-unit/apartment rental categories.
- **Geographic seeds (Klang Valley)**: Kuala Lumpur, Petaling Jaya, Ampang Jaya, Subang Jaya, Shah Alam, Bangi, Putrajaya.

## §2 — Seed URLs

**All 7 confirmed** (re-verified live 2026-08-28, matches [src/config/klMudah.ts](../src/config/klMudah.ts)). The pattern is **not** a single uniform `{city-slug}/rooms-for-rent` — it splits into two shapes depending on administrative level:

- **State/federal-territory level** (Kuala Lumpur and Putrajaya are themselves federal territories, i.e. top-level location slugs): `https://www.mudah.my/{slug}/rooms-for-rent`
  - `kuala-lumpur` → "Room For Rent in Kuala Lumpur" (~3,770 results)
  - `putrajaya` → "Room For Rent in Putrajaya" (~98 results)
- **Sub-area within a state** (Petaling Jaya, Ampang, Subang Jaya, Shah Alam, Bangi are all towns *within* Selangor, not their own top-level slug): `https://www.mudah.my/{state-slug}-{subarea-slug}/rooms-for-rent`
  - `selangor-petaling-jaya` (~479), `selangor-ampang` (~122), `selangor-subang-jaya` (~267), `selangor-shah-alam` (~835), `selangor-bangi` (~225)

A bare `{subarea}/rooms-for-rent` (e.g. `petaling-jaya/rooms-for-rent`) is **not valid** — it 503s at the origin. A two-segment `{state}/{subarea}/rooms-for-rent` is also wrong in a quieter way: it silently redirects to a state-wide keyword search (`/selangor/rooms-for-rent?q=...`, scoped to the whole state and a broader "Sale, Rent and Auction" category) instead of erroring — exactly the kind of silent-fallback trap the Jakarta PRD's price-range note warns about. The only correct form is the single hyphenated `{state}-{subarea}` segment, confirmed by reading the real "Popular Locations" sidebar links Mudah.my's own UI generates, not guessed from the slug taxonomy.

Also confirmed: "Ampang Jaya" (the scope city's full administrative name) has no matching slug on Mudah.my — its listings are labeled and slugged as plain "Ampang" (`selangor-ampang`). The scope guard ([isInKlangValleyScope](../src/config/klMudah.ts)) treats "ampang" as the alias.

Plain `curl`/`WebFetch` against these URLs returns 403/503 (Cloudflare bot protection) even though robots.txt permits them — verification requires a real browser request, not a bare HTTP client. This matches §3's compliance note that the site allows crawling per robots.txt but still runs active bot-detection on non-browser requests.

**Resolved**: no rental-term filter param/segment needs to be appended to the seed URLs. Daily rentals are excluded by the "Room For Rent" category itself (`categoryId 2100`, `type=let`) — every card sampled across these seeds carries `"per month"` pricing and that category ID, confirmed live 2026-08-28 (see `src/config/klMudah.ts`'s header comment). Combined with §1's finding that Mudah.my has no yearly concept either, every seed URL here is effectively monthly-only at the source.

## §3 — Compliance

robots.txt (`https://www.mudah.my/robots.txt`, checked 2026-08-28): disallows only ad-tracking params (`/*?adsby=`), `/*l=1`, `/*th=0`, `/redir`, `/support`, `/rules/*`, `/about.htm`, `/search_tips.htm`, `/security`, `/pg`, `/sendmail`, `/abuse`, `/bannerads.htm`. No Crawl-delay directive is published. None of the disallowed paths overlap with `/rooms-for-rent`, city search pages, or `/{slug}-{id}.htm` detail pages.

Reuse `src/lib/robots.ts`'s pre-run check pattern (§3 of the Jakarta PRD), but **`fetchRobotsRules()` is currently hardcoded to `https://mamikos.com`** ([src/lib/robots.ts:14](../src/lib/robots.ts)) — it must be parameterized to accept a base URL before this crawler can call it with `https://www.mudah.my`.

Since no Crawl-delay is published, reuse the existing default politeness window (`MIN_DELAY_MS`/`MAX_DELAY_MS` = 3–7s, [src/config/politeness.ts](../src/config/politeness.ts)) rather than inventing a new one — same posture as Jakarta.

## §4 — Discovery mechanism (differs materially from Mamikos)

This is the most important architectural finding: **Mudah.my's search-result cards carry a real, static listing URL and listing ID in the DOM** — unlike Mamikos, where "listing cards have no static URL... learning a new listing's URL requires clicking it" ([src/config/politeness.ts:15-20](../src/config/politeness.ts)).

Confirmed on a live Kuala Lumpur search page:

```html
<a href="https://www.mudah.my/{seo-slug}-{listId}.htm"
   data-listid="115481438"
   data-adid="135602472"
   ...>
```

**Consequence**: the click-to-discover-URL flow in [src/crawlers/discovery.ts](../src/crawlers/discovery.ts) (opening a new tab per unknown card, `DailyClickBudget`, `clickWithRetry`) is Mamikos-specific plumbing that **Mudah.my does not need**. A KL discovery crawler can harvest `(listId, url)` pairs directly from each search-result page's anchors — no click budget, no new-tab handling, far fewer requests per discovery run. Do not port `DAILY_NEW_LISTING_CLICK_BUDGET` or the click-based new-listing flow into the KL crawler; it would be solving a problem Mudah.my doesn't have.

**Pagination is numbered, not infinite-scroll.** Confirmed via `data-testid="pagination"` / `data-testid="pagination-next"` — a normal page-N link list, unlike Mamikos' `button.nominatim-list__see-more` "load more" pattern in [src/crawlers/discovery.ts:59](../src/crawlers/discovery.ts). The KL discovery crawler should paginate by following `pagination-next` (or constructing `?page=N`, needs confirming which the site actually uses) until it's exhausted, not by repeated-click-until-count-stops-growing.

**Card-level structured data is also available** via `window.__NEXT_DATA__.props.pageProps.initialStore` on search-result pages (confirmed: contains `listId`, `subject` (title), `subareaName`, `propertySpec` (e.g. size in sq ft), `date`, `categoryName`, `categoryId`, `propertyTypeId`, seller/contact info). This is Mudah.my's equivalent of Mamikos' `window.detail`, but scoped to the search page's card list rather than a single listing. Reading this JSON directly (rather than CSS-selector scraping each card) is likely more robust — confirm its full shape covers everything needed for the lightweight discovery row (price, area, availability-equivalent) before committing to CSS selectors instead.

**Important negative finding**: on the listing *detail* page (`/{slug}-{id}.htm`), `window.__NEXT_DATA__.props.pageProps` was confirmed **empty** — Mudah.my does not expose a `window.detail`-equivalent structured blob on detail pages the way Mamikos does. Detail-page field extraction must be DOM-based (see §5), not JSON-based. Don't spend implementation time hunting for a detail-page JSON global that isn't there.

## §5 — Detail page field extraction

Confirmed via a live listing (`https://www.mudah.my/{slug}-112542160.htm`, checked 2026-08-28).

**Stable `data-testid` attributes exist for**: `ad-title`, `ad-price`, `ad-location`, `ad-detail-size`, `description-title`, `description`, `contact-list`, `adview-cta-chat`, `adview-cta-whatsapp`, `gallery-view-trigger`. Use these — they're stable across deploys.

**No stable selector exists for the "Property Details" grid** (Property Type, Furnishing, Floor Range, Rental Deposit, Tenant Preference). It's a styled-components grid with hashed, build-specific CSS classes (e.g. `style__Text-sc-1aiv0ru-2 gZxQOs`) and no `data-testid`. **Extraction strategy: match on the literal label text**, not a CSS selector — find the `<p>` whose text is exactly `"Rental Deposit"`, read its adjacent sibling `<p>` as the value; same pattern for each label. This is more resilient to a hash-class rebuild than any selector referencing `sc-1aiv0ru` or similar generated class names, which **will** change on Mudah.my's next frontend deploy.

**Confirmed literal field labels found in this grid** (exact strings, case-sensitive):
- `"Property Type"` — the building type (e.g. "Condo / Services residence / Penthouse / Townhouse") — **not** the room type; do not confuse the two.
- `"Furnishing"` (e.g. "Fully Furnished")
- `"Floor Range"` (e.g. "Medium")
- `"Rental Deposit"` (e.g. "RM 1,425") — maps directly to the schema's `deposit_amount_raw` (see §6)
- `"Tenant Preference"` (e.g. "Female") — maps directly to the schema's `tenant_preference_raw` (see §6). Confirms the field even exists as structured data on-site, not just inferred from description text.

**Not found as a structured field on the sampled listing**: Room Type and Refund Conditions.
- **Room Type** appeared only inside the free-text title (e.g. `"...Middle Room(Female Only)"`) and description. It must be parsed from title/description text into the normalized enum decided in the grilling session (single/master/middle/small), the same way Jakarta parses `kost_type`/price text — this is not a shortcut, it's the only signal available. Confirm the enum-matching regex against a larger sample of real titles before assuming "Middle Room", "Master Room", "Single Room", "Small Room" are the only forms used (Malay-language variants like "Bilik Sederhana"/"Bilik Master"/"Bilik Single" also appear in search results — see the raw text sampled in §7).
- **Refund Conditions** was not present as a labeled field on this listing at all. Treat it as **usually null**, populated only when a landlord writes it into the free-text description (best-effort text scan, not a guaranteed field) — do not build the schema or normalize logic assuming every listing has one.

There are two separate amenity-style lists on the detail page, and they should not be merged into one without a name that reflects the distinction — confirm during implementation whether to keep them separate or fold both into one `facilities_raw` array as Jakarta does with `fac_room`/`fac_share`/`fac_bath`:
- **"Facilities"** section — building-level (e.g. Security, Lift, Swimming Pool, Playground, Gymnasium, Sauna)
- **"Amenities"** section — room/unit-level (e.g. Air-Cond, Cooking Allowed, Near KTM/LRT, Washing Machine, Internet) — this is the list that maps onto Jakarta's `FACILITY_TAGS` vocabulary in [workers/ingest/src/normalize.ts:85-97](../workers/ingest/src/normalize.ts); confirm which of the existing tags apply and which new ones (e.g. `near_transit`) are needed.

## §6 — Data schema changes

Building on the existing `ListingRow`/`NormalizedListing` types ([src/types/listing.ts](../src/types/listing.ts), [workers/ingest/src/types.ts](../workers/ingest/src/types.ts), [workers/ingest/src/normalize.ts](../workers/ingest/src/normalize.ts)):

1. **`source` is currently typed as the literal `"mamikos"`** ([src/types/listing.ts:8](../src/types/listing.ts)). Per [ADR-0001](adr/0001-separate-deployment-per-country.md), KL is a separate deployment with its own D1 — so the KL `ListingRow`/`NormalizedListing` types can simply use the literal `"mudah"` (or `"mudah.my"`) instead of widening the Jakarta types into a union. Do **not** modify the Jakarta types to accommodate KL; these are now two independent type definitions in two independent deployments (parallel files, per ADR-0002), not one shared union.
2. **New raw fields**, captured verbatim (no parsing) at scrape time, following the existing `*_raw` doctrine ([src/types/listing.ts:1](../src/types/listing.ts)):
   - `deposit_amount_raw: string | null` — e.g. `"RM 1,425"`
   - `deposit_terms_raw: string | null` — free text, if the site distinguishes deposit terms from the amount (unconfirmed on the sampled listing beyond the bare amount — check other listings for a separate terms string, e.g. "2 months deposit")
   - `refund_conditions_raw: string | null` — usually null (§5)
   - `tenant_preference_raw: string | null` — e.g. `"Female"`, `"Malay"`, `"Chinese"`, `"Indian"`, `"Any"` — confirm the actual value vocabulary against a larger sample before assuming it's race vs. gender vs. both conflated in one field. On the sampled listing the value was "Female" (a gender value in a field literally labeled "Tenant Preference") — **this field may conflate gender and race preference into one string on Mudah.my**, which changes how it maps onto the earlier decision (gender restriction already has its own existing `gender_restriction_raw` field/column). Resolve this ambiguity with more samples before finalizing the column mapping: it's possible `tenant_preference_raw` should feed both `gender_restriction` (existing normalize path) and a new race-preference display field, parsed from the same source string.
3. **Normalization** (new logic in a KL-specific `normalize.ts`, not shared with Jakarta's — see §3 of [ADR-0002](adr/0002-same-repo-parallel-structure.md) on what's shared vs. not):
   - `deposit_amount: number | null` — parse `"RM 1,425"` → `1425`. MYR formatting uses comma thousands-separators (e.g. `1,425`), **not** the Indonesian dot-separator/`jt`/`ribu` shorthand `parsePrice()` handles ([workers/ingest/src/normalize.ts:47-70](../workers/ingest/src/normalize.ts)). Write a new `parsePriceMy()` — do not try to generalize the existing Indonesian-specific parser across currencies.
   - `price_amount` / `price_period`: same currency-format note applies — `"RM 950 per month"` needs its own parse function. **Resolved (§1): Mudah.my has no structured yearly concept** — confirmed via the live filter config, not just an absent sample. `price_period` recognizes only `monthly`/`yearly` (not `weekly`/`daily`, which are out of PRD scope and confirmed absent from the site); the `yearly` match is defensive free-text handling, not a confirmed display format.
   - `room_type`: normalized enum (`single` / `master` / `middle` / `small`), parsed from title/description per §5, with the original matched raw text preserved alongside (per the earlier grilling decision — normalized enum + raw string kept, not enum-only).
   - `tenant_preference_raw` is **stored, and displayed read-only on the listing card** — it must **never** be added to the chat tool's filterable/searchable schema (the KL equivalent of `workers/chat/src/tools.ts`'s tool-call JSON schema). This is [ADR-0004](adr/0004-tenant-preference-not-filterable.md) — flagging explicitly here so whoever builds the KL chat worker's tool schema doesn't wire it up "for free" because the column already exists.
4. **D1 schema**: the KL database's `listings` table mirrors [workers/ingest/src/db.ts](../workers/ingest/src/db.ts)'s `LISTING_COLUMNS`, plus `deposit_amount`, `deposit_amount_raw`, `deposit_terms_raw`, `refund_conditions_raw`, `tenant_preference_raw`, `room_type` (normalized enum column, separate from the existing `room_type_raw` column both deployments already have).

## §7 — Sample data (for calibrating parsers/regexes before writing them)

Raw titles/prices observed on a live Kuala Lumpur search results page, 2026-08-28 (useful for building and testing the room-type and price regexes against real variance, not synthetic examples):

```
RM 950 per month — Cheras, Kuala Lumpur — "...Fully Furnished– Middle Room(Female Only)"
RM 400 per month — Bertam, Penang — "Bilik Female Single Untuk Disewa Fully Furnished Wifi Gated & Guarded"
RM 600 per month — Damansara Perdana, Selangor — "(Female) Single Bed Medium Room - Windows & A/C Fully Furnished Wifi"
RM 800 per month — Balakong, Selangor — "BILIK Single Laki Master Toilet DI SILK RESIDENCE -Parking Bas stop"
RM 700 per month — Cheras, Kuala Lumpur — "Room Rental @ Annex Taman Taman Connaught Cheras KL"
RM 1,700 per month — Johor Bahru, Johor — "Master Room bilik Sewa R&F Mall Walking Distance to CIQ"
RM 1,200 per month — Ampang, Kuala Lumpur — "Studio Jln Ampang KLCC Great Eastern Mall Gleneagles Hospital LR"
```

Note the mixed English/Malay wording in the wild ("Bilik" = room, "Laki"/"Perempuan" = male/female, "Sederhana" = medium/middle) — the room-type and gender parsers both need to handle Malay terms, not just English, the same way Jakarta's `GENDER_SYNONYMS`/`FACILITY_TAG_SYNONYMS` handle Indonesian terms ([workers/ingest/src/normalize.ts:101-181](../workers/ingest/src/normalize.ts)).

Also note: results returned outside the Klang Valley scope (Penang, Johor Bahru) appear in the "Room For Rent in Malaysia"-wide listing — **the per-city seed URLs (§2) are what constrains scope**, the same way `isInKlangValleyScope()` (KL's equivalent of `isInJakartaScope()`, [src/config/jakarta.ts:52](../src/config/jakarta.ts)) must verify each listing's actual `area_raw`/city text against the 7-city allowlist, since a listing could theoretically surface via cross-promo outside its own city's seed page.

## §8 — Resilience / retirement / resumability

Reuse the existing patterns as-is — nothing about Mudah.my's site behavior contradicts them:
- Per-listing failure handling, retirement after `RETIREMENT_FAILURE_THRESHOLD` consecutive failures, resumability within a run ([src/crawlers/detailRefresh.ts](../src/crawlers/detailRefresh.ts))
- `domcontentloaded` + explicit field-readiness wait rather than `networkidle` (Mudah.my is also a JS-heavy SPA-style site with continuous background analytics traffic — confirm this empirically during implementation the same way Jakarta's PRD notes it was confirmed, but assume it applies)

## §9 — Explicitly out of scope for this PRD

- Speedhome, Wetopia, iBilik, Roomz.asia — separate PRDs once each source's DOM/data has been confirmed the same way this document confirms Mudah.my's.
- Singapore — deferred (see [ADR-0001](adr/0001-separate-deployment-per-country.md) context and the grilling session).
- Cross-country search/unification.
- Making `tenant_preference_raw` (or any race/religion-derived value) filterable anywhere in the product — permanently out of scope per [ADR-0004](adr/0004-tenant-preference-not-filterable.md), not just this phase.

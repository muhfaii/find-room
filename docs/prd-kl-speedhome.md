# PRD: Kuala Lumpur / Klang Valley — Speedhome Scraper (Phase 2 of the KL expansion)

Status: ready for implementation. This is source #2 of the KL build order agreed in [ADR-0001](adr/0001-separate-deployment-per-country.md) / [ADR-0002](adr/0002-same-repo-parallel-structure.md) (Mudah.my → **Speedhome** → Wetopia → iBilik → Roomz.asia — see [docs/prd-kl-mudah.md](prd-kl-mudah.md) for why Utopia and BeLive, the original slots #4/#5, were dropped). Written the same way [docs/prd-kl-mudah.md](prd-kl-mudah.md) was — against the live site, not assumptions carried over from either prior source.

**Read this before assuming Speedhome works like Mudah.my — it doesn't.** Mudah.my is a classifieds marketplace with no structured backend exposed to visitors (raw-field scraping + downstream parsing, per [prd-kl-mudah.md §5-§6](prd-kl-mudah.md)). Speedhome is a managed-rental platform with a full property-management backend, and its Next.js pages embed that backend's actual API response verbatim in server-side JSON — deposit amounts, room type, gender preference, and even nationality/religion preference all arrive as **already-structured fields**, not free text to parse. This changes the shape of the whole scraper: there is very little DOM scraping to do here, and the ethical care this PRD asks for (§6) is different in kind from Mudah.my's, not just degree.

## §1 — Scope

- **Country/deployment**: same Kuala Lumpur / Klang Valley deployment as Mudah.my (own D1, own chat worker — unchanged from [prd-kl-mudah.md §1](prd-kl-mudah.md)). Speedhome listings land in the **same** KL database as Mudah.my's, distinguished by `source: "speedhome"` — this is a second source within one deployment, not a third deployment (re-read [ADR-0001](adr/0001-separate-deployment-per-country.md): the ADR is about country-level separation, not per-source).
- **Source**: Speedhome only, for this phase.
- **Category**: room listings only — Speedhome's `type` field takes three values (`HIGHRISE`, `ROOM`, `LANDED`); only `ROOM` is in scope. Confirmed live 2026-08-28: `/rent/{city}/room` scopes the search results to `type: "ROOM"` only (verified: the unfiltered `/rent/kuala-lumpur` page mixes all three types, 511 results; `/rent/kuala-lumpur/room` returns only `ROOM`-typed listings, 91 results).
- **Rental term**: **Speedhome has no yearly-priced listings either** — same finding as Mudah.my ([prd-kl-mudah.md §1](prd-kl-mudah.md)), confirmed differently here because the data is structured rather than free text: `price` is a plain number and, across every sampled listing, stays in the RM200–2000/month range regardless of lease length — it is always a **monthly rate**. What Speedhome *does* have that Mudah.my doesn't is a genuine structured **`minRentalDuration`** field (values observed: `6` and `12` — months), meaning "the lease commitment is N months," a different concept from "the price is billed yearly." Do not conflate the two — see §5.
- **Geographic seeds (Klang Valley)**: same 7 cities as Mudah.my — Kuala Lumpur, Petaling Jaya, Ampang Jaya, Subang Jaya, Shah Alam, Bangi, Putrajaya.

## §2 — Seed URLs

Confirmed live 2026-08-28, pattern is **uniform** across all 7 cities (unlike Mudah.my's two-shape state/subarea split — see [prd-kl-mudah.md §2](prd-kl-mudah.md)):

```
https://speedhome.com/rent/{city-slug}/room
```

All 7 confirmed with plain, single-word-or-hyphenated slugs, no state prefix needed:

| City | Slug | Confirmed result count (2026-08-28) |
|---|---|---|
| Kuala Lumpur | `kuala-lumpur` | 91 |
| Petaling Jaya | `petaling-jaya` | 36 |
| Ampang Jaya | `ampang` | 16 |
| Subang Jaya | `subang-jaya` | (linked in nav, not individually counted) |
| Shah Alam | `shah-alam` | (linked in nav, not individually counted) |
| Bangi | `bangi` | 8 |
| Putrajaya | `putrajaya` | 19 |

`ampang` (not `ampang-jaya`) is the correct slug — same "Ampang Jaya listings are labeled/slugged as plain Ampang" fact as Mudah.my ([prd-kl-mudah.md §2](prd-kl-mudah.md)); this is a real Malaysian-administrative-naming pattern, not a per-source coincidence, and later KL sources should be checked for the same thing rather than assumed.

**Pagination**: `?page=N` query param, confirmed working (`/rent/kuala-lumpur/room?page=2` returns page 2's 40 results; `propertyList.totalPages`/`totalElements`/`size` in the embedded JSON — see §4 — tell you exactly how many pages exist, so there's no need to page-until-empty guessing the way Mamikos' infinite-scroll required).

Plain `curl`/`WebFetch` against these URLs returns HTTP 403 (confirmed 2026-08-28) even though robots.txt permits them — same Cloudflare-bot-protection situation as Mudah.my ([prd-kl-mudah.md §2](prd-kl-mudah.md)). Verification and scraping both require a real browser request.

## §3 — Compliance

robots.txt (`https://speedhome.com/robots.txt`, checked 2026-08-28): `Allow: /` for `*`, with `Disallow: /dashboard/`, `/reels/`, and `/rent/*%26` / `/sewa/*%26` / `/zh/rent/*%26` / `/my/sewa/*%26` (literal `&` in a query string — irrelevant to the clean `/rent/{city}/room?page=N` paths this scraper uses). No Crawl-delay directive. None of the disallowed paths overlap with what this scraper touches.

Reuse `src/lib/robots.ts` exactly as the Mudah.my crawler does — parameterize `fetchRobotsRules("https://speedhome.com")`. Reuse the default politeness window (3–7s) since no Crawl-delay is published, same reasoning as both prior sources.

## §4 — Discovery mechanism: read the embedded JSON, don't scrape the DOM

Both the search-results page and the listing detail page are Next.js pages that embed the **exact same structured object shape** in `window.__NEXT_DATA__` — confirmed by comparing a card's fields against its own detail page's fields for the same listing (`id: 302695`): identical values for every field checked (`roomType`, `noDeposit`, `securityDeposit`, `propertyTenantPreference`, `price`, `city`, `state`, ...).

- **Search results**: `window.__NEXT_DATA__.props.pageProps.propertyList` — a Spring-style paginated response: `{ content: [...], totalElements, totalPages, number, size, first, last }`. Each element of `content` is a full property record (see field list in §5) — not a lightweight card. There is no separate "click to learn the URL" step needed (same simplification as Mudah.my vs. Mamikos — see [prd-kl-mudah.md §4](prd-kl-mudah.md)): every card already carries `id` and `slug`, from which the canonical detail URL is `https://speedhome.com/details/{slug}`.
- **Detail page**: `window.__NEXT_DATA__.props.pageProps.propertyInfo` — the same record shape as one `content[]` element. Confirmed field-for-field identical to the search card for the same listing.
- **Practical consequence**: discovery and detail-refresh can share nearly all of their field-extraction logic, since both pull from the same JSON shape — consider a single `extractSpeedhomeFields(propertyJson)` function used by both crawlers, rather than duplicating field-mapping logic the way Jakarta/Mudah.my's discovery (lightweight card) and detail-refresh (full record) necessarily differ. This is a genuine architectural opportunity specific to this source; don't assume the Mudah.my two-tier discovery/detail-refresh split is the template to copy mechanically.
- **No DOM label-matching needed** for anything covered by the JSON (which is nearly everything — see §5's field table). The only thing you may still need the rendered DOM/page metadata for is the `<title>`-derived SEO text and confirming a listing is genuinely still live if `active`/`status` ever look stale relative to what's rendered.

## §5 — Field mapping (structured, not raw-text)

Unlike Mudah.my, most of the fields below require **no downstream parsing at all** — they arrive typed. This changes what "raw-field-only doctrine" means here: the doctrine (see [prd-kl-mudah.md's Standards-review outcome](prd-kl-mudah.md)) exists to stop the *scraper* from doing classification/inference on ambiguous free text. Reading an already-typed JSON field verbatim is not inference — `row.deposit_amount = json.securityDeposit` is a direct copy, not parsing, and belongs in the scraper layer same as `row.title = json.name` does. Only fields that genuinely require interpretation (see the bottom of this table) belong in the normalize step.

| Speedhome field | KL schema field | Notes |
|---|---|---|
| `id` | (used to derive `listing_id`) | Numeric. |
| `slug` | (used to derive `url`) | Canonical URL: `https://speedhome.com/details/{slug}` |
| `name` | `title` | |
| `type` | (scope filter, not stored) | Must equal `"ROOM"` — verify even though the seed URL already filters, same "verify scope guard on every listing, not just trust the seed" doctrine as Jakarta/Mudah.my. |
| `roomType` | `room_type` (enum) | **Confirmed values across samples: `SMALL`, `MEDIUM`, `MASTER` only — no `SINGLE` value was ever observed.** This does not map 1:1 onto the KL cross-source enum (`single`/`master`/`middle`/`small`) decided in the grilling session: `SMALL`→`small`, `MEDIUM`→`middle`, `MASTER`→`master` is the natural mapping, but **`single` may simply never occur for this source** — confirm against a larger sample before assuming `SMALL` and `single` are the same concept; a small room and a single-occupancy room are not necessarily the same thing, and Mudah.my's title text (§/prd-kl-mudah.md §5) does distinguish them. Store `roomType` (Speedhome's raw enum string) alongside the mapped value, same pattern as Mudah.my's room_type_raw. |
| `bathroomType` | facility tag (`private_bathroom`/`shared_bathroom`) | Structured enum (`SHARED` confirmed; presumably `PRIVATE` too) — maps directly, no synonym table needed the way Mudah.my's free-text amenities list does. |
| `price` | `price_amount` | Plain number, already in MYR, always monthly (§1). No `parsePriceMy`-style text parsing needed — this is a straight copy. Do **not** reuse Mudah.my's price parser here; there's no text to parse. |
| `minRentalDuration` | `min_rental_duration_months` (new column — [ADR-0006](adr/0006-min-rental-duration-is-not-price-period.md)) | Months (6, 12 observed). This is a genuine "how long must I commit" concept the current schema has no field for (Mudah.my has nothing equivalent, rows stay `null`). Do not force this into `price_period` — it isn't a billing period. |
| `securityDeposit` | `deposit_amount` | Plain number, MYR. **See the `noDeposit` contradiction below before wiring this up naively.** |
| `utilitiesDeposit` | `utilities_deposit_amount` (new column, kept separate from `deposit_amount` — [ADR-0005](adr/0005-speedhome-deposit-fields-not-collapsed.md)) | A *second* deposit figure Mudah.my's schema has no separate slot for. |
| `noDeposit` | `no_deposit_program` (new column, kept separate from `deposit_amount` — [ADR-0005](adr/0005-speedhome-deposit-fields-not-collapsed.md)) | **Confirmed contradiction, deliberately not resolved by this PRD**: sampled listings exist with `noDeposit: true` **and** `securityDeposit` in the hundreds/thousands (e.g. one listing: `noDeposit: true, securityDeposit: 1850`). This almost certainly means `noDeposit` is Speedhome's "zero-deposit **program** eligibility" marketing flag (the tenant doesn't pay the deposit upfront themselves — Speedhome or an insurance product covers it) rather than "this listing's actual deposit amount is zero." If Speedhome's own help center clarifies the semantics before implementation, update this note; until then, treat the contradiction as a known fact, not a solved one — do not treat `no_deposit_program: true` as implying `deposit_amount` is 0 or meaningless. |
| `propertyTenantPreference.gender` | `gender_restriction` | Confirmed enum values: `"MALE"`, `"FEMALE"`, `"ALL"`. This is the one part of `propertyTenantPreference` that **is** a legitimate filter (same category as Jakarta's/Mudah.my's existing gender_restriction) — extract only this sub-field into the normal gender enum. |
| `propertyTenantPreference.malaysian`, `.foreigner`, `.isMuslim`, `.country`, `.profession` | `tenant_preference_raw` (display-only) | **ADR-0004 applies directly and with more force than on Mudah.my.** `isMuslim` is a literal religion-preference boolean; `country` is a literal nationality-preference array (values observed: `["ALL"]`, `["SEA","WESTERN","EAST_ASIA"]`); `malaysian`/`foreigner` split preference by citizenship. These are clean, pre-structured fields — exactly the shape that makes wiring up a filter trivially easy, which is exactly the scenario [ADR-0004](adr/0004-tenant-preference-not-filterable.md) was written to prevent ("a future engineer who notices the data is already there and wires up a filter 'for free'"). Serialize the non-gender parts of `propertyTenantPreference` into `tenant_preference_raw` for read-only display (e.g. "Malaysians only" / "Muslim tenants only" / "Open to: Malaysia, Southeast Asia" — write a human-readable formatter, don't just dump raw JSON at the user), and do not expose `isMuslim`, `country`, `malaysian`, `foreigner`, or `profession` as filter/tool-schema parameters anywhere, ever. |
| `city`, `state` | `city_raw`, scope guard input | **Confirmed nullable**: some listings on the Kuala Lumpur seed page have `city: null` (3 of 15 sampled). The scope guard must treat a null city as unresolved, not as a pass — fall back to `address` (a full free-text string) if you need a location signal for a null-city listing, or skip it, but do not let a null city silently satisfy `isInKlangValleyScope`. Also confirmed: `city` values outside the 7-city scope leak through a city-scoped seed page just like Mudah.my/Jakarta — e.g. `"Batu Caves"` appeared on the `kuala-lumpur` seed's results. Reuse (or extend) `isInKlangValleyScope` from `src/config/klMudah.ts` rather than writing a new one — the concept and the 7-city list are shared across KL sources. |
| `facilities`, `utilityTypes`, `furnishes` | `facilities_raw` / `amenities_raw` equivalent | Three separate arrays, different vocabularies (`utilityTypes` sample: `["INTERNET","WATER","ELECTRICITY"]`; `furnishes` sample: `["kitchen_cabinet","wardrobe","washing_machine",...]` — already snake_case!). Decide during implementation whether these fold into the existing `FACILITY_TAGS_KL` vocabulary or need their own — `furnishes`' values look close enough to already match several existing tags (`wardrobe`, `water_heater`) but use a different naming convention than Mudah.my's free-text-derived tags, so the synonym table may need Speedhome-specific keys even though the target vocabulary can stay the same. |
| `images[].imageUrl` | `image_urls` | Direct array of URLs, no `img[src*=...]` DOM-scanning needed (contrast with Mudah.my's gallery-selector approach). |
| `description` | `description_raw` | Free text, same as other sources. |
| `status`, `active`, `isRented` | `availability_status_raw` | Structured (`status: "ACTIVE"`, `active: true`, `isRented: false` confirmed) — a real signal Mamikos/Mudah.my don't have (both left this field null with a TODO). Worth actually populating for Speedhome rather than leaving null by habit. |
| `address` | `address_raw` | Full free-text address string, same concept as other sources. |
| `latitude`, `longitude` | `latitude`, `longitude` | Direct copy, both sources already have these fields. |

**No structured or free-text "refund conditions" field exists anywhere in the schema** (confirmed: searched the full field list and a sample listing's JSON for anything refund-related — nothing). Unlike Mudah.my, where `refund_conditions_raw` is a best-effort text scan of `description` ([prd-kl-mudah.md §6](prd-kl-mudah.md)), Speedhome's deposit model is fully numeric (`securityDeposit`/`utilitiesDeposit`/`noDeposit`) with no free-text refund-terms concept at all. `refund_conditions_raw` should stay `null` for Speedhome unless a future description-text scan is added — do not invent a value for it.

## §6 — Ethics: ADR-0004 is more directly at stake here than on Mudah.my

Re-stating [ADR-0004](adr/0004-tenant-preference-not-filterable.md) explicitly for this source, because the risk profile is different, not just present: on Mudah.my, `tenant_preference_raw` was one ambiguous free-text string that took real reverse-engineering effort to even find. On Speedhome, `propertyTenantPreference.isMuslim` and `.country` are **already clean, typed, individually-addressable fields** sitting right next to the legitimate `.gender` field in the same object — an implementer who writes `argsToFilters()` for the chat tool schema by iterating over `propertyTenantPreference`'s keys, or who builds a Vectorize metadata object by spreading the same object, will wire up a religion/nationality filter *by accident*, not by a deliberate bad decision. This PRD requires:

1. `propertyTenantPreference` must be destructured field-by-field at the point of ingestion, never spread or iterated generically. `gender` goes to the real enum; everything else goes to a formatted `tenant_preference_raw` display string and nowhere else.
2. The KL chat tool schema (`workers/chat-kl/src/tools.ts`) must not gain a `isMuslim`, `country`, `nationality`, `religion`, or `citizenship` filter parameter for Speedhome listings, exactly as it must not for Mudah.my's tenant preference.
3. Whoever reviews the Speedhome implementation should specifically re-run the same defense-in-depth check the Mudah.my review did (chat tool schema, `argsToFilters`/`mergeFilters`, Vectorize metadata construction, frontend rendering) — this is not a one-time check that stays valid across sources; each new source's raw shape needs it re-verified.

## §7 — Schema decisions (resolved via ADR)

- **`minRentalDuration`** gets its own nullable `min_rental_duration_months` column — it is *not* `price_period` (§1/§5) and there is no equivalent on Mudah.my (those rows stay `null`). See [ADR-0006](adr/0006-min-rental-duration-is-not-price-period.md).
- **`utilitiesDeposit`** stays a separate `utilities_deposit_amount` column, not summed into `deposit_amount` — summing would silently lose information (e.g. whether the utilities deposit refunds on different terms than the security deposit). See [ADR-0005](adr/0005-speedhome-deposit-fields-not-collapsed.md).
- **`noDeposit`** is stored as its own `no_deposit_program` boolean column alongside `deposit_amount`, per §5's "don't resolve the contradiction" finding — see the same ADR.

## §8 — Resilience / retirement / resumability

Reuse the existing patterns unchanged, same as Mudah.my ([prd-kl-mudah.md §8](prd-kl-mudah.md)): per-listing failure handling, retirement after `RETIREMENT_FAILURE_THRESHOLD` consecutive failures, resumability within a run, `domcontentloaded` + explicit readiness wait (confirm empirically whether Speedhome also has the continuous-background-traffic `networkidle`-never-fires problem the other two sources do — not yet checked for this source specifically).

## §9 — Explicitly out of scope for this PRD

- Wetopia, iBilik, Roomz.asia — separate PRDs once each source's DOM/data has been confirmed the same way this document confirms Speedhome's.
- Resolving the `noDeposit`/`securityDeposit` contradiction (§5) — flagged, not resolved.
- Deciding the exact chat-facing copy for the `tenant_preference_raw` display string (§5/§6) — implementation detail, not a schema/architecture decision.
- Singapore, cross-country search/unification — unchanged from [prd-kl-mudah.md §9](prd-kl-mudah.md).

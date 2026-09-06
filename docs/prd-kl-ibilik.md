# PRD: Kuala Lumpur / Klang Valley — iBilik Scraper (Phase 4 of the KL expansion)

Status: ready for implementation — §6/§7's decisions are resolved, see [ADR-0008](adr/0008-ibilik-preference-and-pii-handling.md). Source #4 of the KL build order (Mudah.my → Speedhome → Wetopia → **iBilik** → Roomz.asia). Written the same way the prior PRDs were, against the live site.

**Read this before assuming iBilik is "another Mudah.my."** It looks like one on the surface — a huge classifieds-style marketplace — but its backend (a modern TanStack Start app, not classic PHP) exposes a fully structured, richly typed data model, more comparable to Speedhome than Mudah.my. That includes an explicit, first-class **`RACE`** preference field — not inferred, not conflated with gender, a literal `type: "RACE", code: "malay"/"chinese"/"indian"/"other"` structure. This is the most direct race-preference data of any source scraped so far, and it changes what "being careful" means here.

## §1 — Scope and scale

- **Country/deployment**: same KL deployment (`source: "ibilik"` in the shared D1 table).
- **Category**: `type: "ROOM"` is the discriminator (other confirmed values on this platform: at least `ELDERLY_CARE`; the homepage also advertises Hotel/Confinement Centre/Event Space/Private Office/Commercial categories — re-verify `type === "ROOM"` per listing, same doctrine as every other source, don't trust the URL alone).
- **Scale, confirmed live 2026-08-28** via the loaded page state (not a search-result estimate): Kuala Lumpur state alone has **10,111 room listings**; Petaling Jaya **5,713**; Shah Alam **1,759**; Subang Jaya **1,278**; Ampang **141**; Bangi **85**; Putrajaya **47**. This is the largest catalog of any KL source found so far — larger than Mudah.my's own Kuala Lumpur numbers.
- **Geographic seeds**: all 7 Klang Valley cities confirmed reachable (§2). iBilik's own taxonomy nests Ampang/Petaling Jaya/Subang Jaya/Shah Alam/Bangi under `state=selangor`, and (unexpectedly) nests **Putrajaya under `state=kuala-lumpur`**, not its own state bucket — a real quirk of this platform's own taxonomy, not a mistake to "fix."

## §2 — Seed URLs and pagination

Pattern, confirmed live 2026-08-28:

```
https://www.ibilik.com/locations/malaysia/{state-code}/{city-code}
https://www.ibilik.com/locations/malaysia/{state-code}          (state-level aggregate, e.g. all of Kuala Lumpur)
```

| City | Path | Confirmed count |
|---|---|---|
| Kuala Lumpur (state) | `/locations/malaysia/kuala-lumpur` | 10,111 |
| Petaling Jaya | `/locations/malaysia/selangor/petaling-jaya` | 5,713 |
| Ampang | `/locations/malaysia/selangor/ampang` | 141 |
| Subang Jaya | `/locations/malaysia/selangor/subang-jaya` | 1,278 |
| Shah Alam | `/locations/malaysia/selangor/shah-alam` | 1,759 |
| Bangi | `/locations/malaysia/selangor/bangi` | 85 |
| Putrajaya | `/locations/malaysia/kuala-lumpur/putrajaya` | 47 |

Given the Kuala Lumpur *state* page alone already covers all of KL (including Cheras, a KL sub-district used for initial sampling), decide during implementation whether to seed on the state-level KL page or enumerate KL's own sub-districts separately — the state page is simpler and already confirmed to return room-scoped counts matching `listingTypeCounts` exactly.

Pagination is `?page=N` (confirmed via the loader's `parsed.page` field, default `1`). No "load more" clicking, no click-budget — same simplification as Mudah.my/Speedhome.

## §3 — Discovery mechanism: read the TanStack Start loader state, don't scrape the DOM

iBilik is a **TanStack Start** app (confirmed via `window.__TSR_ROUTER__`, `window.__TSS_START_OPTIONS__` — not Next.js, not WordPress). Its router keeps fully-loaded route data in memory:

```js
window.__TSR_ROUTER__.state.matches[<last>].loaderData
```

- **Search/location pages**: `loaderData.cards` — an array of lightweight cards (`id`, `href`, `title`, `description`, `images`, `currency`, `price`, `priceUnit`, `location`, `points` (amenity phrases), `badges`), plus `loaderData.totalItems`/`totalPages`/`listingTypeCounts`. Confirmed: `price`/`priceUnit`/`currency` are already typed (`price: 550, priceUnit: "month", currency: "MYR"`) — no text parsing needed, same as Speedhome.
- **Detail pages** (`https://www.ibilik.com{href}`, `href` taken directly from the card): `loaderData.listing` — a **much richer** object than the card: `region`/`state`/`city`/`area` (each a `{id, code, locales}` taxonomy term — the cleanest, most reliable location data of any source; scope-guard against `state.code` directly instead of free-text substring matching), `amenities`/`utilities` (structured, coded), `preferences` (see §6 — the sensitive part), `ratePlans` (structured charge line items, e.g. `{name: "Monthly Rent", chargeUnit: "PER_MONTH", chargeAmount: 550, currency: "MYR"}` — a listing can have more than one rate plan; check for a separate deposit-type entry before assuming deposit is only ever in free text), `longTermRoomRentalListing` (`{isStudio, roomType, bathroomType, unitType, floorLevel}`), `contactInformation`/`postedBy` (see §7 — a different, non-ADR-0004 privacy concern).

**Important negative finding**: no `robots.txt` exists on iBilik at all — confirmed both via `WebFetch` (404) and a real browser navigation (404, not a bot-detection redirect). Absence of a robots.txt is not a prohibition (crawling is conventionally unrestricted when none is published), but there's also no published Crawl-delay to defer to — reuse the default 3-7s politeness window as a self-imposed floor, the same posture the codebase already takes when a site is silent rather than explicit.

## §4 — Room type: `SINGLE` confirmed, resolving a question the last two sources left open

Confirmed live on two different listings: `longTermRoomRentalListing.roomType` takes at least the values `"SINGLE"` and `"MASTER"`. **This is the first source to confirm a literal `SINGLE` value exists** — both Speedhome (`SMALL`/`MEDIUM`/`MASTER` only) and Wetopia (`Master`/`Medium`/`Small` text only) left open whether "single" is ever a real, distinct category on any KL source, or whether it's specific to Mudah.my's own free-text title conventions. iBilik confirms it's a real, structured value elsewhere too. Sample more listings before finalizing the `MEDIUM`/`SMALL`-equivalent mapping — only `SINGLE` and `MASTER` were directly observed.

## §5 — Deposit: itemized rate plans, not a single figure

Unlike every prior source, deposit-style charges live in the same structured `ratePlans` array as rent, distinguished by `name`/`chargeUnit` rather than a dedicated `deposit` field. The one listing sampled had only a `"Monthly Rent"` rate plan (its description mentioned "Zero deposit / 1 month deposit" in free text — the same regex-extraction fallback Mudah.my uses would apply here too, in the normalize step, not the scraper). Confirm against a broader sample whether other listings carry an explicit deposit-named rate plan before assuming free-text extraction is the only path — the schema clearly supports a structured one; it may just not be filled in for every listing.

## §6 — ADR-0004 applies here with the highest stakes yet — do not implement without addressing this explicitly

Confirmed live, the `preferences` array on a real listing carries entries shaped like:

```json
{ "preference": { "type": "RACE", "code": "malay", "locales": { "en-US": { "name": "Malay" } } } }
```

The full observed `type` taxonomy across two sampled listings: `GENERAL` (e.g. `prefer-move-in-immediately`, `prefer-zero-deposit`, `preferred-listing` — landlord/platform soft-preference flags, not tenant-screening), `LEASE_TERM` (`6-month`, `12-month-and-above`, `less-than-6-month`), `NATIONALITY` (`malaysian`, `non-malaysian`), `OCCUPATION` (`student`, `employed`), **`RACE`** (`malay`, `chinese`, `indian`, `other`), and **`STATUS`** (`single-female`, `single-male`, `couple`).

This needs explicit, deliberate routing, not a generic "store the array":

- **`STATUS`** is the actual gender-restriction signal on this source (`single-female`/`single-male`/`couple`) — this is the one type that should feed the real `gender_restriction` enum, analogous to Speedhome's `propertyTenantPreference.gender`. Map `single-female`→`female_only`, `single-male`→`male_only`; `couple` doesn't cleanly map to the existing `mixed` value (a couple-only listing is neither "any gender" nor "restricted to one gender" — it's a relationship-status restriction) — this needs its own decision, not a forced fit into an enum that doesn't describe it. Don't silently map `couple` to `mixed` just because both currently return non-null.
- **`RACE` and `NATIONALITY`** are exactly what [ADR-0004](adr/0004-tenant-preference-not-filterable.md) exists for — more explicitly than any prior source's data. These must be destructured by `type`, never generically iterated or spread, and must never reach a filter/tool-schema parameter, following the same single-choke-point pattern established in `speedhomeExtract.ts`.
- **`LEASE_TERM`** is a legitimate, non-sensitive concept (comparable to Speedhome's `minRentalDuration`/ADR-0006), but it's shaped differently here — a discrete preference *code* (`6-month`), not a raw integer. Whether this becomes its own schema field or a formatted string in `deposit_terms_raw`-adjacent territory is an open modeling question, not resolved by this PRD.
- **`OCCUPATION`** and **`GENERAL`** are lower-stakes (student/employed preference; platform/landlord soft-preference flags) but still shouldn't be assumed harmless without a decision — `GENERAL`'s `prefer-zero-deposit`/`preferred-listing` codes look like internal platform signals more than tenant-facing preferences, worth confirming they're not something else entirely before surfacing them anywhere.

**Resolved ([ADR-0008](adr/0008-ibilik-preference-and-pii-handling.md))**: `RACE`, `NATIONALITY`, `OCCUPATION`, and `GENERAL` are stored raw and formatted into `tenant_preference_raw` for read-only display, same posture as Speedhome, never a filter parameter. `STATUS`'s `couple` code maps to `mixed` (accepted loss: a couple-specific preference reads identically to no restriction). `LEASE_TERM` reuses `min_rental_duration_months` (ADR-0006's column): `6-month`→`6`, `12-month-and-above`→`12`, `less-than-6-month`→`null` (no fixed number to represent).

## §7 — A different, new privacy consideration: landlord PII is embedded directly in listing data

Confirmed live: `listing.contactInformation` and `listing.postedBy` carry a real name, phone number, WhatsApp contact, verification status, and role information for the person who posted the listing (e.g. `{"label": "Aeshah", "contactType": "WHATSAPP", "contactValue": "+60102668761", ...}`, `postedBy: {"name": "Aeshah", "isVerified": true, "isKycVerified": true, ...}`). This is publicly displayed on the source site to any visitor — scraping it isn't accessing anything private — but **storing a real person's name and phone number in our own database is a separate decision from displaying price or facilities**, and none of the prior sources' schemas have a contact-info field at all (they just link out to the source's own contact flow via the listing URL).

**Resolved ([ADR-0008](adr/0008-ibilik-preference-and-pii-handling.md))**: none of it is stored. No `contact_name`/`contact_phone` columns — the listing `url` is the contact path, same as every other source.

## §8 — Resilience / retirement / resumability

Standard patterns apply unchanged. No source-specific concerns found.

## §9 — Explicitly out of scope for this PRD

- Roomz.asia — separate PRD, same live-verification standard as this one.
- Confirming the full `roomType`/`ratePlans` enum space against a larger sample than two listings.

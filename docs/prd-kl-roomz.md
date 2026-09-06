# PRD: Kuala Lumpur / Klang Valley — Roomz.asia Scraper (Phase 5 of the KL expansion)

Status: ready for implementation, pending the trust/safety note below. Source #5 of the KL build order (Mudah.my → Speedhome → Wetopia → iBilik → **Roomz.asia**). Written the same way the prior PRDs were, against the live site.

## §0 — Trust/safety check (why this source got extra scrutiny before any technical research)

This source was flagged for caution before any technical work started. Findings, checked 2026-09-06:

- **Trustpilot**: only 1 review (3.6/5) — too little data to draw a conclusion either way.
- **Scamvoid**: rated "Potentially Safe" — 10-year-old domain (created 2016), clean across all 9 malware/blocklist engines checked, valid HTTPS.
- **Search results**: the scam complaints found are about the **generic Malaysian rental-market pattern** — a third party posts a suspiciously-cheap listing on *any* open marketplace and asks for a cash deposit before disappearing — not conduct by Roomz.asia itself. Roomz's own blog publishes tenant-safety advice about this exact market-wide problem, the posture a legitimate marketplace takes, not evidence of the platform itself being complicit.
- **Assessment**: no evidence found that Roomz.asia carries materially more risk than Mudah.my, which is already in scope — both are open marketplaces where any third party can post, carrying the same inherent exposure to fraudulent individual listings. This is not a reason to exclude the source; it's a reason to consider a **product-level mitigation that isn't specific to this source**: a general rental-scam safety tip in the chat product (never pay a deposit in cash, verify the landlord in person, etc.) would help users across every marketplace source, not just this one. That's a product decision for you, not something this PRD implements.

## §1 — Scope

- **Country/deployment**: same KL deployment (`source: "roomz"` in the shared D1 table).
- **Category**: the site has three top-level categories — `/rent/room`, `/rent/property`, `/rent/car_park`. Only `/rent/room` is in scope. Location pages (see §2) mix all three categories together and must be filtered client-side by URL shape (`/rent/room/...`), not trusted to be room-only.
- **Legal entity**: operated by "EasyRoomz Sdn. Bhd." per the site footer — a different, apparently unrelated company from any other source in this list (worth noting only because "Roomz.asia" and "roomz.asia/blog" content referenced during the original grilling research and this platform are, as far as this check could confirm, the same company/site — no conflicting entity found).

## §2 — Seed URLs and discovery mechanism (revised after implementation-time verification)

**Resolved — the JSON-LD/per-location approach originally proposed here doesn't work at scale and was replaced.** Confirmed live 2026-09-06: `/location/{area-slug}` pages have a hard cap (no pagination control at all — checked by scrolling a full page, no "Prev/Next" present) and returned exactly **36 items on two different locations** (Petaling Jaya and the whole of "WP Kuala Lumpur"), a suspiciously round match suggesting a fixed display cap, not each area's true inventory. Location pages also don't cover the 7-city scope directly: there is **no `Kuala Lumpur` location in the site's own popular-locations list** (only KL's ~18 individual sub-districts — Cheras, KLCC, Sentul, etc. — are listed, though `/location/kuala-lumpur` does resolve as an unlinked page), and **no `Putrajaya` location exists at all**. Enumerating 7-8+ capped, incomplete per-city pages was going to under-count badly.

**Actual discovery mechanism: paginate the global room category.**

```
https://my.roomz.asia/rent/room?page={n}       (seed — every room listing nationwide, 20/page)
https://my.roomz.asia/rent/room/{code}/{slug}  (individual room listing — unchanged)
```

Confirmed live: `/rent/room` has real, working pagination (`Prev 1/265 Next`, ~265 pages × 20/page ≈ 5,300 room listings nationwide) with a real `?page=N` URL directly on the "Next" link — not JSON-LD, not infinite scroll. Each card is a stable `<a class="property-listing-card">` element with a static `href`, an `<h2>` title, and a `<p>` location string (e.g. `"Damansara Perdana, Selangor"`). This is the same "search broad nationwide, scope-guard precisely per listing" pattern every other KL source already uses (Mudah.my's Malaysia-wide keyword fallback, Speedhome's cross-city leakage) — it sidesteps the location-page cap entirely and needs only one seed instead of 7-8.

No `window.__NEXT_DATA__`/TanStack-router-state equivalent was found on this site — it does not appear to be a client-rendered SPA framework (no matching global markers detected). Field extraction for both discovery cards and the detail page (§3) is DOM-based, not JSON-based, similar to Mudah.my and Wetopia.

**Also confirmed**: landlord names are shown directly on cards and detail pages (`"Listed by {name}"`) — same PII situation as iBilik (ADR-0008). Not stored, same policy, no fresh sign-off needed since it's an existing established decision being applied to a new source, not a new one.

## §3 — Detail page fields (DOM-based)

Confirmed via two live listings, checked 2026-09-06. No stable `data-testid`-style attributes were found in the accessibility-tree read used for this check — extraction should key off label text (e.g. the literal strings `"Rental Deposit :"`, `"Male Only"`, `"Single Room"`), the same doctrine as Mudah.my's Property Details grid and Wetopia's Room Options section, until DOM class-name stability is separately confirmed.

Confirmed fields and their literal label text:
- **Price**: `"RM 650.00 / month"` — same free-text-with-currency-and-period shape as Mudah.my, needs the same kind of parser (though the number format here uses plain decimals, not comma thousands-separators in the samples seen — confirm against a 4+ digit price before assuming no comma-grouping ever appears).
- **Deposit — itemized, not a single figure.** This is the most granular deposit data of any KL source checked: a summary figure ("RM 700.00 Deposit") plus an itemized breakdown table under a "Deposit Detail" heading, e.g.:
  ```
  Rental Deposit : RM 650.00
  Access Card Deposit : RM 50.00
  ```
  The line-item labels are **not from a fixed enum confirmed yet** — only "Rental Deposit" and "Access Card Deposit" have been observed; other listings may have different or additional line items (e.g. a utility deposit). Recommend capturing the full itemized table as structured `{label, amount}` pairs (summed for `deposit_amount`, kept verbatim for `deposit_terms_raw`) rather than only reading the summary figure, since the summary figure alone would silently drop the itemization this source uniquely offers.
- **Room type**: confirmed literal `"Single Room"` under a "Features" section — maps directly onto the existing enum, same clean mapping as iBilik's `SINGLE`.
- **Bathroom type**: `"Shared Bathroom"` (confirmed) — presumably `"Private Bathroom"` also exists, not directly observed but a safe inference given every other source has both.
- **Lease term**: `"Min. 6 Months Contract"` — a genuine minimum-lease-duration concept, same category as Speedhome's `minRentalDuration` (ADR-0006) and iBilik's `LEASE_TERM` preference. A fourth source, a fourth slightly different shape (free text with an embedded number here, vs. a raw integer on Speedhome, vs. a discrete preference code on iBilik) — don't assume one parser handles all three.
- **Gender restriction**: confirmed literal `"Male Only"` and `"Female Only"` (both observed, on two different listings) under the same "Features" section as room type — a clean, direct mapping to the existing `gender_restriction` enum.
- **Occupation preference**: `"Any Profession"` observed on both sampled listings — low-stakes, same category as iBilik's `OCCUPATION` type.
- **Cooking policy**: `"Light Cooking"` — a facility-tag-shaped concept neither prior source's vocabulary has a clean existing tag for; check whether it fits `kitchen_access` or deserves its own tag before defaulting to the unknown-label fallback.
- **Utilities/amenities**: a clean bullet list under "Utilities" (e.g. Air Conditioning, Refrigerator, Shower Heater, Washing Machine, WiFi Access) — maps onto the existing facility-tag vocabulary with minimal new synonyms needed.
- **"Nearby" section**: neighborhood amenities (school, hospital, mall, etc.) — not tied to the room itself, same as Wetopia's "Easy Access To" section; not part of the room schema, contextual only.

**Confirmed NOT observed on either sampled listing: any race, religion, or nationality preference field.** Only gender ("Male Only"/"Female Only") and occupation ("Any Profession") appeared under Features. This is an **unconfirmed absence**, not a confirmed one — two samples is not enough to conclude the concept never appears on this platform, especially given iBilik (a comparably-sized Malaysian platform) has an explicit `RACE` field. Treat this the same way Wetopia's tenant-preference gap was treated: don't assume it's permanently null until a larger sample confirms it, and if a race/nationality-shaped field does turn up later, it goes through the same ADR-0004 destructuring discipline as every other source's sensitive fields, from day one — not bolted on after the fact.

## §4 — Compliance

robots.txt (`https://my.roomz.asia/robots.txt`, checked 2026-09-06): `Allow: /` for all user-agents, no path restrictions, no named-bot blocks (confirmed no ClaudeBot/GPTBot/etc. disallow entries — unlike BeLive), no Crawl-delay directive. Reuse the default 3-7s politeness window and the standard `fetchRobotsRules("https://my.roomz.asia")` pattern.

## §5 — Resilience / retirement / resumability

Standard patterns apply unchanged. No source-specific concerns found.

## §6 — Explicitly out of scope for this PRD

- Deciding whether to add a general rental-scam safety disclaimer to the product (§0) — a real, actionable idea surfaced by this source's review, but a product decision, not a scraper implementation detail.
- Confirming whether a race/nationality-preference field exists anywhere on this platform (§3) — flagged as unconfirmed absence, not resolved.
- This is the last source in the current KL build order — no further "explicitly out of scope, separate PRD" pointer needed unless a sixth source is added later.

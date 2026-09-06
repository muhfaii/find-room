# find-rooms

Scrapes room-rental listings from source sites, normalizes them into a database, and serves them through a chat interface. Currently spans two country deployments: Jakarta (Indonesia, live) and Kuala Lumpur (Malaysia, in progress).

## Language

**Source Site**:
The specific platform a listing was scraped from (e.g. Mamikos, Mudah.my, Speedhome, Wetopia). A country deployment may pull from multiple source sites over time; each listing records which one it came from.
_Avoid_: Provider, platform (when referring to a specific site rather than the general concept)

**Marketplace Source**:
A source site that aggregates listings from many independent third-party landlords (Mamikos, Mudah.my, Speedhome). Large catalogs, architecturally similar discovery/detail-refresh crawling.
_Avoid_: Aggregator

**Operator Source**:
A source site that only lists rooms in properties it manages itself (Wetopia — the only confirmed one in the current KL build order). Small, curated catalogs; no third-party landlord concept. Not every co-living-branded site actually has a browsable catalog to scrape at all — see [[prd-kl-mudah]]'s note on why Utopia Co-living was dropped.
_Avoid_: Co-living site (co-living is the property style; "operator source" is the crawling category)

**Rental Term**:
The billing cadence a listing is offered under. Jakarta scope is monthly only ("bulanan"); Kuala Lumpur scope is monthly and yearly. Daily rentals are out of scope for both.
_Avoid_: Rental period, lease type

**Room Type** *(Kuala Lumpur only)*:
A normalized category — single, master, middle, or small room — describing the physical room being rented. Stored alongside the source site's original raw wording, since mapping from source text to the enum is best-effort.
_Avoid_: Room category, unit type

**Tenant Preference** *(Kuala Lumpur only)*:
A landlord-stated race/religion preference for the tenant, common on Malaysian listings. Stored as scraped and shown read-only on the listing card. It is deliberately never a searchable or filterable attribute — see [ADR-0004](docs/adr/0004-tenant-preference-not-filterable.md).
_Avoid_: Race filter, demographic filter

**Deposit Terms**:
The raw landlord-stated deposit condition text for a listing (e.g. "2 months deposit + 1 month advance", "zero deposit"). Kept alongside a structured `Deposit Amount` where one can be parsed.
_Avoid_: Deposit description

**Refund Conditions**:
The raw landlord-stated terms for returning a tenant's deposit, kept as free text since conditions vary too much per listing to normalize confidently yet.

**Klang Valley**:
The Kuala Lumpur deployment's geographic scope: Kuala Lumpur, Petaling Jaya, Ampang Jaya, Subang Jaya, Shah Alam, Bangi, and Putrajaya. Mirrors how the Jakarta deployment scopes to DKI Jakarta's 5 administrative cities rather than one.
_Avoid_: KL (ambiguous between the city and the whole scoped region)

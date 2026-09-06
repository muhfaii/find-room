# Speedhome's minRentalDuration is its own column, not folded into price_period

Speedhome exposes `minRentalDuration` (months — `6` and `12` observed live, 2026-08-28), which states how long a tenant must commit to a lease. Sampled listings show this varies independently of price and billing cadence: `price` is always a plain monthly MYR figure regardless of whether `minRentalDuration` is 6 or 12. This is a minimum-lease-length concept, not a "how often is this listing billed" concept — the two are easy to conflate because both later would be described using "12 months"/"yearly"-shaped language, but they answer different questions (how long must I commit vs. how often do I pay).

The KL schema gets a new nullable `min_rental_duration_months` column for this, rather than reusing or overloading `price_period` (whose values are `monthly`/`yearly`, describing billing cadence only — see [prd-kl-mudah.md](../prd-kl-mudah.md) §1/§6.3). Mudah.my rows simply leave this column `null`, since that source has no equivalent concept, rather than Speedhome's lease-length data being forced into a billing-period field it doesn't describe.

## Consequences

Any future KL source with its own lease-commitment concept should reuse `min_rental_duration_months` rather than inventing another column, provided the concept genuinely means "minimum commitment length" and not something else wearing similar words.

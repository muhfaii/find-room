# Separate deployment per country instead of a unified multi-country schema

Kuala Lumpur gets its own D1 database, its own chat worker, and its own normalize rules, rather than being merged into Jakarta's existing schema and worker. Jakarta and Kuala Lumpur differ in currency (IDR vs MYR), city-scope shape, and business rules that don't exist on the other side at all (deposit/refund terms, tenant race preference, room-type enum) — forcing them into one schema now would mean designing multi-currency and multi-country-scope handling speculatively, and risks regressing a live product (Jakarta) to accommodate a country whose data shape is still being discovered.

## Considered Options
- Unified schema/worker with a `country` column and per-country field handling — rejected: couples two independently-evolving data shapes and deploy cycles before either is settled.

## Consequences
Cross-country search/comparison (e.g. "show me rooms in Jakarta or KL") is not possible without a later unification project. This is accepted as out of scope for now.

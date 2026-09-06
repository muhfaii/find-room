# Speedhome's deposit signals are stored as three separate raw fields, never collapsed into one

Speedhome exposes three deposit-related fields per listing — `noDeposit` (boolean), `securityDeposit` (number), `utilitiesDeposit` (number) — and confirmed live sampling (2026-08-28) found listings where `noDeposit: true` co-occurs with a nonzero `securityDeposit` (e.g. `noDeposit: true, securityDeposit: 1,850`). This contradicts the field name at face value: `noDeposit` most likely means "zero-deposit **program** eligibility" (Speedhome or an insurance product covers the deposit so the tenant doesn't pay it upfront) rather than "this listing's deposit amount is zero," but that reading is inferred, not confirmed by Speedhome's own documentation.

Rather than pick an interpretation and collapse these into one `deposit_amount`, the KL schema stores `no_deposit_program` (boolean, verbatim), `deposit_amount` (from `securityDeposit`, verbatim), and `utilities_deposit_amount` (from `utilitiesDeposit`, verbatim) as three separate columns. Whichever field turns out to be "wrong" once the semantics are actually confirmed (e.g. from Speedhome's help center, or a support inquiry), the raw data needed to correct it is still there — collapsing now would silently and irreversibly discard one of the two signals.

## Consequences

Anything reading deposit info (chat tool, frontend display) must account for the `noDeposit`/`securityDeposit` contradiction explicitly rather than assuming `no_deposit_program: true` implies `deposit_amount` is meaningless or zero. This ADR does not resolve which field is authoritative — that's deferred until the semantics are actually confirmed.

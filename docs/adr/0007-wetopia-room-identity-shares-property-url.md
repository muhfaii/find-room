# Wetopia rooms are one row per room, sharing the property's URL

Wetopia has no stable per-room URL — every room's "Book Now" button links to the same generic contact page regardless of which room it is ([KL Wetopia PRD §4](../prd-kl-wetopia.md)). Only the property (`/listing/{slug}/`) has a real, stable URL; a room within it does not.

Rather than roll rooms up into one coarse per-property row (losing the per-room price/type/facility granularity every other KL source has), each room becomes its own row with a synthesized `listing_id` (`wetopia-{property-slug}-room-{index}`) and a `url` that points at the shared property page. `{index}` is the room's position in the property page's "Room Options" list at scrape time — this is a known, accepted fragility: if a room is added, removed, or reordered on the property page between scrapes, the index-based identity can silently point at a different physical room than before, or stop matching anything (see detail-refresh's handling, which treats a missing index as a refresh failure feeding the existing retirement mechanism, not a special case).

## Consequences

- A user who clicks through from a specific room the chat recommended lands on a page showing every room in that property, not just the one discussed. This should be surfaced honestly in the chat/UI copy (e.g. "see this room among Property X's listings"), not presented as if the link points at that exact room.
- Multiple `listing_id`s legitimately share one `url` in the KL D1 table — this is intentional, not a data bug, and any future code that assumes `url` uniquely identifies a listing (true for every other current KL source) must not be applied unmodified to Wetopia rows.
- If room ordering on a property page turns out to be unstable in practice, this identity model will produce visible churn (rooms appearing to retire and reappear under new ids). That's an accepted cost of a small-catalog source with no better identity signal available, not a bug to fix by adding false precision the source itself doesn't offer.

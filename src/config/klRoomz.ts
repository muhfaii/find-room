// KL Roomz PRD §2 (revised after implementation-time verification): the
// per-location JSON-LD approach originally proposed doesn't work — location
// pages are hard-capped at ~36 items with no pagination, don't cover all 7
// target cities directly (no "Kuala Lumpur" in the site's own nav; no
// "Putrajaya" location exists at all), and can't be trusted as a complete
// enumeration. The actual discovery seed is the global room category, which
// has real, confirmed working pagination — the same "search broad
// nationwide, scope-guard precisely per listing" pattern every other KL
// source already uses.
export const ROOMZ_SEED_URL = "https://my.roomz.asia/rent/room";

// Confirmed live 2026-09-06: ~265 pages at 20/page (~5,300 room listings
// nationwide). Generous headroom above that, matching the same "defensive
// cap, not a tight fit" reasoning as every other source's MAX_PAGES constant.
export const MAX_PAGES = 400;

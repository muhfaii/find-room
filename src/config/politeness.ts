// PRD §4 / §9: single sequential browser context, randomized 3-7s delay between
// navigations, no concurrency. Re-validated at runtime against robots.txt (see
// src/lib/robots.ts) — if the site starts publishing a stricter Crawl-delay, that
// wins over these defaults.
export const MIN_DELAY_MS = 3_000;
export const MAX_DELAY_MS = 7_000;

// PRD §4 / §8: consecutive weekly detail-refresh failures before a listing is
// auto-retired from the active queue (with an audit log, not silent deletion).
export const RETIREMENT_FAILURE_THRESHOLD = 3;

// PRD §4: detail refresh is sharded across the week rather than run in one pass.
export const DETAIL_REFRESH_SHARD_COUNT = 7;

// PRD §4: listing cards have no static URL in the DOM — learning a new listing's
// URL requires clicking it (opens a new tab). To keep any single day's request
// volume bounded, only this many NEW (not-yet-known) listings are clicked per
// discovery run; the rest are picked up on subsequent days since discovery
// re-scans the full catalog daily anyway.
export const DAILY_NEW_LISTING_CLICK_BUDGET = 300;

export function politeDelayMs(): number {
  return MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
}

export async function politeWait(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, politeDelayMs()));
}

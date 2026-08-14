// Observed in testing: clicks on mamikos.com can intermittently fail with
// "<html> intercepts pointer events" even when Playwright's own built-in
// retry-until-stable logic (up to its action timeout) is exhausted — likely a
// transient overlay (ad slot, toast, etc.) rather than a permanent block. This
// wraps a click in a few bounded, spaced-out retries before giving up, since a
// single stuck action shouldn't be allowed to throw all the way up and abort an
// entire crawl run (PRD §8 resilience philosophy, extended from per-listing
// failures to page-level interactions).
export async function clickWithRetry(
  action: () => Promise<void>,
  maxAttempts = 3,
  delayMs = 2000,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await action();
      return;
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { RETIREMENT_FAILURE_THRESHOLD } from "../config/politeness.js";

export interface KnownListing {
  listingId: string;
  url: string;
  cityRaw: string;
  signature: string; // see lib/signature.ts — card fields fingerprint, avoids re-clicking known cards
  firstSeenAt: string;
  lastRefreshedAt: string | null;
  consecutiveFailures: number;
  shard: number; // 0-6, which day-of-week this listing refreshes on
}

export interface RetiredListing extends KnownListing {
  retiredAt: string;
  reason: string;
}

interface StoreShape {
  active: Record<string, KnownListing>; // keyed by listingId
  signatureIndex: Record<string, string>; // signature -> listingId, for click-skip lookups
  retired: RetiredListing[];
}

// PRD §4 idempotency: dedup key is the listing URL / listing_id — re-scraping the
// same listing updates the same logical record rather than duplicating it.
// PRD §4/§8: 3 consecutive weekly detail-refresh failures auto-retires a listing
// from the active queue, with an audit trail (not silent deletion).
export class KnownListingsStore {
  private path: string;
  private data: StoreShape;

  constructor(path: string) {
    this.path = path;
    this.data = existsSync(path)
      ? JSON.parse(readFileSync(path, "utf-8"))
      : { active: {}, signatureIndex: {}, retired: [] };
  }

  private save(): void {
    writeFileSync(this.path, JSON.stringify(this.data, null, 2), "utf-8");
  }

  // PRD §4: a card's signature (city+area+title+price, see lib/signature.ts) is
  // checked before clicking — if already known, discovery skips the click and
  // reuses the stored listingId/url for the lightweight daily row.
  findBySignature(signature: string): KnownListing | undefined {
    const listingId = this.data.signatureIndex[signature];
    return listingId ? this.data.active[listingId] : undefined;
  }

  // Called when discovery clicks a genuinely new card and captures its full field
  // set (PRD §4: capturing full details on first click, since the page load cost
  // is already paid). Sets lastRefreshedAt now too, so this listing isn't
  // redundantly re-fetched by its next weekly detail-refresh shard right away.
  upsertFromDiscoveryClick(listingId: string, url: string, cityRaw: string, signature: string, now: string): void {
    if (this.data.active[listingId]) return; // idempotent — already known
    this.data.active[listingId] = {
      listingId,
      url,
      cityRaw,
      signature,
      firstSeenAt: now,
      lastRefreshedAt: now,
      consecutiveFailures: 0,
      // Deterministic shard assignment so a listing always refreshes on the same
      // day of the week, spreading load evenly (PRD §4 sharding).
      shard: hashToShard(listingId),
    };
    this.data.signatureIndex[signature] = listingId;
    this.save();
  }

  listingsForShard(shard: number): KnownListing[] {
    return Object.values(this.data.active).filter((l) => l.shard === shard);
  }

  recordRefreshSuccess(listingId: string, now: string): void {
    const listing = this.data.active[listingId];
    if (!listing) return;
    listing.lastRefreshedAt = now;
    listing.consecutiveFailures = 0;
    this.save();
  }

  // Returns true if this failure caused retirement.
  recordRefreshFailure(listingId: string, now: string, reason: string): boolean {
    const listing = this.data.active[listingId];
    if (!listing) return false;
    listing.consecutiveFailures += 1;
    if (listing.consecutiveFailures >= RETIREMENT_FAILURE_THRESHOLD) {
      delete this.data.active[listingId];
      delete this.data.signatureIndex[listing.signature];
      this.data.retired.push({ ...listing, retiredAt: now, reason });
      this.save();
      return true;
    }
    this.save();
    return false;
  }
}

function hashToShard(listingId: string): number {
  let hash = 0;
  for (let i = 0; i < listingId.length; i++) {
    hash = (hash * 31 + listingId.charCodeAt(i)) >>> 0;
  }
  return hash % 7;
}

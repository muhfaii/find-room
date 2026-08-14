import { readFileSync, writeFileSync, existsSync } from "node:fs";

// PRD §9 resumability: an interrupted sharded detail-refresh run can resume
// without re-scraping listings already completed earlier in the same run.
// Keyed by run date (UTC, YYYY-MM-DD) so a fresh day starts a fresh progress set.
export class RunProgressStore {
  private path: string;
  private runDate: string;
  private done: Set<string>;

  constructor(path: string, runDate: string) {
    this.path = path;
    this.runDate = runDate;
    this.done = this.load();
  }

  private load(): Set<string> {
    if (!existsSync(this.path)) return new Set();
    const data = JSON.parse(readFileSync(this.path, "utf-8"));
    if (data.runDate !== this.runDate) return new Set(); // new day, fresh progress
    return new Set(data.doneListingIds as string[]);
  }

  private save(): void {
    writeFileSync(
      this.path,
      JSON.stringify({ runDate: this.runDate, doneListingIds: [...this.done] }, null, 2),
      "utf-8",
    );
  }

  isDone(listingId: string): boolean {
    return this.done.has(listingId);
  }

  markDone(listingId: string): void {
    this.done.add(listingId);
    this.save();
  }
}

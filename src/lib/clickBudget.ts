import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { DAILY_NEW_LISTING_CLICK_BUDGET } from "../config/politeness.js";

// PRD §4: caps new-listing clicks per discovery run so cold-start bootstrapping
// of the full catalog happens gradually across many days instead of one massive
// run. Keyed by UTC date so a fresh day resets the count; if a run is interrupted
// and restarted the same day, the count persists so we don't exceed the budget.
export class DailyClickBudget {
  private path: string;
  private runDate: string;
  private used: number;

  constructor(path: string, runDate: string) {
    this.path = path;
    this.runDate = runDate;
    this.used = this.load();
  }

  private load(): number {
    if (!existsSync(this.path)) return 0;
    const data = JSON.parse(readFileSync(this.path, "utf-8"));
    if (data.runDate !== this.runDate) return 0;
    return data.used as number;
  }

  private save(): void {
    writeFileSync(this.path, JSON.stringify({ runDate: this.runDate, used: this.used }, null, 2), "utf-8");
  }

  hasRemaining(): boolean {
    return this.used < DAILY_NEW_LISTING_CLICK_BUDGET;
  }

  recordClick(): void {
    this.used += 1;
    this.save();
  }
}

import { appendFileSync } from "node:fs";

// PRD §8: run-level summary log — pages attempted/succeeded/failed/skipped, total
// runtime. Per-listing failures log listing_id/url and are skipped, never abort
// the run.
export class RunLogger {
  private path: string;
  private startedAt: number;
  private attempted = 0;
  private succeeded = 0;
  private failed = 0;
  private skipped = 0;

  constructor(logPath: string, private crawlType: string) {
    this.path = logPath;
    this.startedAt = Date.now();
  }

  private write(line: string): void {
    const stamp = new Date().toISOString();
    appendFileSync(this.path, `[${stamp}] ${line}\n`, "utf-8");
  }

  info(message: string): void {
    this.write(`INFO ${message}`);
  }

  success(listingId: string, url: string): void {
    this.attempted += 1;
    this.succeeded += 1;
    this.write(`OK listing_id=${listingId} url=${url}`);
  }

  failure(listingId: string, url: string, reason: string): void {
    this.attempted += 1;
    this.failed += 1;
    this.write(`FAIL listing_id=${listingId} url=${url} reason=${reason}`);
  }

  skip(listingId: string, url: string, reason: string): void {
    this.attempted += 1;
    this.skipped += 1;
    this.write(`SKIP listing_id=${listingId} url=${url} reason=${reason}`);
  }

  abort(reason: string): void {
    this.write(`ABORT reason=${reason}`);
  }

  summarize(): void {
    const runtimeMs = Date.now() - this.startedAt;
    this.write(
      `SUMMARY crawl_type=${this.crawlType} attempted=${this.attempted} ` +
        `succeeded=${this.succeeded} failed=${this.failed} skipped=${this.skipped} ` +
        `runtime_ms=${runtimeMs}`,
    );
  }
}

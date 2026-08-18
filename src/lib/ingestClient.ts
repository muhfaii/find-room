import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ListingRow } from "../types/listing.js";

// HTTP sink replacing the CSV output (src/lib/csv.ts): POSTs raw ListingRows to
// the ingestion Worker, which normalizes + embeds into D1/Vectorize. Follows the
// codebase's per-listing resilience philosophy — a single failed POST never
// throws up into the crawl; it dead-letters instead and is retried on the next
// run via resubmitDeadLetterQueue().

export interface IngestResult {
  listing_id: string;
  status: "upserted" | "error";
  vector_updated?: boolean;
  error?: string;
}

const DEAD_LETTER_PATH = "data/ingest-failures.jsonl";
const MAX_ATTEMPTS = 3;

function ingestConfig(): { url: string; secret: string } | null {
  const url = process.env.INGEST_WORKER_URL;
  const secret = process.env.INGEST_SHARED_SECRET;
  if (!url || !secret) {
    console.warn(
      "[ingestClient] INGEST_WORKER_URL / INGEST_SHARED_SECRET not set — skipping ingest (no dead-letter). Check .env.",
    );
    return null;
  }
  return { url: url.replace(/\/$/, ""), secret };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Adapts the clickWithRetry pattern (src/lib/retry.ts): 3 attempts with ~2s/4s
// backoff. Throws only after all attempts are exhausted.
async function postJsonWithRetry(config: { url: string; secret: string }, path: string, body: unknown): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${config.url}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.secret}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`ingest worker responded ${res.status}: ${text}`);
      }
      return;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(attempt * 2000); // 2s, 4s
      }
    }
  }
  throw lastError;
}

function appendDeadLetter(entries: Record<string, unknown>[]): void {
  mkdirSync(dirname(DEAD_LETTER_PATH), { recursive: true });
  const lines = entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
  appendFileSync(DEAD_LETTER_PATH, lines, "utf-8");
}

// POSTs rows to /ingest. Never throws: on final failure each row is appended to
// the dead-letter queue as one JSON line. A 200 response that contains per-row
// status:"error" entries is NOT dead-lettered — that's a normalization bug to be
// investigated, not a transient failure.
export async function ingestRows(rows: ListingRow[]): Promise<void> {
  if (rows.length === 0) return;
  const config = ingestConfig();
  if (!config) return;

  try {
    await postJsonWithRetry(config, "/ingest", { rows });
  } catch (err) {
    const failedAt = new Date().toISOString();
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[ingestClient] POST /ingest failed (${reason}) — dead-lettering ${rows.length} row(s)`);
    appendDeadLetter(
      rows.map((row) => ({
        kind: "ingest",
        row,
        failedAt,
      })),
    );
  }
}

// POSTs a retirement to /retire. Never throws: same retry-then-dead-letter
// treatment as ingestRows, with a "kind" discriminator so resubmission knows
// which endpoint to replay against.
export async function retireListing(listingId: string): Promise<void> {
  const config = ingestConfig();
  if (!config) return;

  try {
    await postJsonWithRetry(config, "/retire", { listing_id: listingId });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[ingestClient] POST /retire failed (${reason}) — dead-lettering listing ${listingId}`);
    appendDeadLetter([
      {
        kind: "retire",
        listing_id: listingId,
        failedAt: new Date().toISOString(),
      },
    ]);
  }
}

interface DeadLetterEntry {
  kind: "ingest" | "retire";
  row?: ListingRow;
  listing_id?: string;
  failedAt?: string;
}

// Reads data/ingest-failures.jsonl if present, groups "ingest" lines into one
// batch /ingest POST and replays "retire" lines individually, then rewrites the
// file with only lines that still failed (or removes it when drained). Malformed
// lines are dropped (they'd fail again forever otherwise).
export async function resubmitDeadLetterQueue(): Promise<void> {
  if (!existsSync(DEAD_LETTER_PATH)) return;

  const rawLines = readFileSync(DEAD_LETTER_PATH, "utf-8").split("\n").filter(Boolean);
  const entries: DeadLetterEntry[] = [];
  for (const line of rawLines) {
    try {
      const parsed = JSON.parse(line) as DeadLetterEntry;
      if (parsed && (parsed.kind === "ingest" || parsed.kind === "retire")) entries.push(parsed);
    } catch {
      // drop malformed line
    }
  }
  if (entries.length === 0) {
    unlinkSync(DEAD_LETTER_PATH);
    return;
  }

  const config = ingestConfig();
  if (!config) return; // keep the file as-is; next run will retry

  const stillFailing: DeadLetterEntry[] = [];

  const ingestEntries = entries.filter((e) => e.kind === "ingest");
  if (ingestEntries.length > 0) {
    try {
      await postJsonWithRetry(config, "/ingest", {
        rows: ingestEntries.map((e) => e.row),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[ingestClient] dead-letter resubmit /ingest failed (${reason}) — re-queuing`);
      stillFailing.push(
        ...ingestEntries.map((e): DeadLetterEntry => ({ kind: "ingest", row: e.row, failedAt: new Date().toISOString() })),
      );
    }
  }

  for (const entry of entries.filter((e) => e.kind === "retire")) {
    try {
      await postJsonWithRetry(config, "/retire", { listing_id: entry.listing_id });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[ingestClient] dead-letter resubmit /retire failed (${reason}) — re-queuing`);
      stillFailing.push({ kind: "retire", listing_id: entry.listing_id, failedAt: new Date().toISOString() });
    }
  }

  if (stillFailing.length > 0) {
    writeFileSync(
      DEAD_LETTER_PATH,
      stillFailing.map((e) => JSON.stringify(e)).join("\n") + "\n",
      "utf-8",
    );
  } else {
    unlinkSync(DEAD_LETTER_PATH);
  }
}

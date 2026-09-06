import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { KlAnyListingRow } from "../types/klAnyListing.js";

// HTTP sink for the Kuala Lumpur deployment — the parallel of src/lib/ingestClient.ts
// (ADR-0002: parallel files per deployment). Same per-listing resilience
// philosophy, pointed at the KL ingest worker with its own env vars, its own
// dead-letter queue, and the KL ListingRow type. Jakarta and KL are independent
// deployments (own D1, own worker URL — ADR-0001), so this file must not share
// the Jakarta dead-letter path or env vars with the Jakarta client.

export interface IngestResult {
  listing_id: string;
  status: "upserted" | "error";
  vector_updated?: boolean;
  error?: string;
}

const DEAD_LETTER_PATH = "data/ingest-failures-kl.jsonl";
const MAX_ATTEMPTS = 3;

function ingestConfig(): { url: string; secret: string } | null {
  const url = process.env.INGEST_KL_WORKER_URL;
  const secret = process.env.INGEST_KL_SHARED_SECRET;
  if (!url || !secret) {
    console.warn(
      "[ingestClientKl] INGEST_KL_WORKER_URL / INGEST_KL_SHARED_SECRET not set — skipping ingest (no dead-letter). Check .env.",
    );
    return null;
  }
  return { url: url.replace(/\/$/, ""), secret };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 3 attempts with ~2s/4s backoff; throws only after all attempts are exhausted.
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
// the dead-letter queue as one JSON line. A 200 with per-row status:"error" is
// NOT dead-lettered — that's a normalization bug to investigate, not transient.
export async function ingestRowsKl(rows: KlAnyListingRow[]): Promise<void> {
  if (rows.length === 0) return;
  const config = ingestConfig();
  if (!config) return;

  try {
    await postJsonWithRetry(config, "/ingest", { rows });
  } catch (err) {
    const failedAt = new Date().toISOString();
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[ingestClientKl] POST /ingest failed (${reason}) — dead-lettering ${rows.length} row(s)`);
    appendDeadLetter(
      rows.map((row) => ({
        kind: "ingest",
        row,
        failedAt,
      })),
    );
  }
}

// POSTs a retirement to /retire. Never throws: retry-then-dead-letter, same as
// ingestRowsKl, with a "kind" discriminator for resubmission routing.
export async function retireListingKl(listingId: string): Promise<void> {
  const config = ingestConfig();
  if (!config) return;

  try {
    await postJsonWithRetry(config, "/retire", { listing_id: listingId });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[ingestClientKl] POST /retire failed (${reason}) — dead-lettering listing ${listingId}`);
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
  row?: KlAnyListingRow;
  listing_id?: string;
  failedAt?: string;
}

// Replays data/ingest-failures-kl.jsonl: "ingest" lines in one batch POST,
// "retire" lines individually; rewrites the file with only lines that still
// failed (or removes it when drained). Malformed lines are dropped.
export async function resubmitDeadLetterQueueKl(): Promise<void> {
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
      console.warn(`[ingestClientKl] dead-letter resubmit /ingest failed (${reason}) — re-queuing`);
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
      console.warn(`[ingestClientKl] dead-letter resubmit /retire failed (${reason}) — re-queuing`);
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

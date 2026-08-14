import { appendFileSync, writeFileSync, existsSync } from "node:fs";
import { LISTING_ROW_COLUMNS, type ListingRow } from "../types/listing.js";

// PRD §6.4: missing/not-found fields are a truly empty cell, never "null"/"N/A"/0.
// PRD §6.3: multi-value fields are serialized as a JSON array string in one cell.
function cellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}

// PRD §6.1: RFC 4180 quoting — double-quote fields containing commas, quotes, or
// newlines; escape internal quotes by doubling.
function quoteField(raw: string): string {
  if (/[",\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function rowToCsvLine(row: ListingRow): string {
  return LISTING_ROW_COLUMNS.map((col) => quoteField(cellValue(row[col]))).join(",");
}

export function csvFileName(crawlType: "discovery" | "detail_refresh", now = new Date()): string {
  // PRD §6.1: mamikos_{crawl_type}_{YYYYMMDD_HHMMSS}.csv — no geo tag, run is
  // Jakarta-only by construction and city_raw already carries that info.
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}_` +
    `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `mamikos_${crawlType}_${stamp}.csv`;
}

export class CsvRunWriter {
  private filePath: string;
  private headerWritten = false;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  writeRow(row: ListingRow): void {
    if (!this.headerWritten) {
      const header = LISTING_ROW_COLUMNS.join(",");
      if (!existsSync(this.filePath)) {
        writeFileSync(this.filePath, header + "\n", { encoding: "utf-8" });
      }
      this.headerWritten = true;
    }
    appendFileSync(this.filePath, rowToCsvLine(row) + "\n", { encoding: "utf-8" });
  }
}

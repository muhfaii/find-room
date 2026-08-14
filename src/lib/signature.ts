import { createHash } from "node:crypto";

// PRD §4: listing cards on search pages carry no static ID/URL. To avoid
// re-clicking a card we've already captured, we build a signature from fields
// already visible on the card (no click required) and check it against the
// known-listings store before deciding to click.
export function computeCardSignature(
  cityRaw: string,
  areaRaw: string | null,
  title: string,
  priceRawText: string,
): string {
  const normalize = (s: string | null) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const parts = [normalize(cityRaw), normalize(areaRaw), normalize(title), normalize(priceRawText)];
  return createHash("sha1").update(parts.join("|")).digest("hex");
}

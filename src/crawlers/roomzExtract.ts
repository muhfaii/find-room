import type { Page } from "playwright";
import type { CrawlType, KlRoomzListingRow } from "../types/klRoomzListing.js";

// KL Roomz PRD §2/§3: no window.__NEXT_DATA__/TanStack router state exists on
// this site — every extraction here is DOM-based, keyed on the stable
// `a.property-listing-card` class (search cards) or literal section
// heading/label text (detail page), the same doctrine as Mudah.my's Property
// Details grid and Wetopia's Room Options parsing.

// ---- search/discovery ----

export interface RoomzCard {
  href: string;
  title: string;
  addressRaw: string | null;
  priceRawText: string;
  imageUrl: string | null;
}

export interface RoomzListPage {
  cards: RoomzCard[];
  hasNextPage: boolean;
}

export async function extractRoomzListPage(page: Page): Promise<RoomzListPage> {
  await page.waitForSelector("a.property-listing-card", { timeout: 20000 }).catch(() => {});

  return page.evaluate<RoomzListPage>(() => {
    const cards = Array.from(document.querySelectorAll("a.property-listing-card")).map((el) => {
      const anchor = el as HTMLAnchorElement;
      const title = anchor.querySelector("h2")?.textContent?.trim() ?? "";
      const addressRaw = anchor.querySelector("p")?.textContent?.replace(/\s+/g, " ").trim() || null;
      // Price is rendered as two adjacent spans ("RM 650.00" + "/ month").
      // Matched anchored to the START of the span text (^RM, ^/) rather than
      // an unanchored substring test — a landlord name span ("Listed by
      // {name}") is also a <span> on this card, and an unanchored /RM|month/i
      // would match any name containing that substring anywhere (e.g.
      // "Firman", "Norman"), leaking the landlord's name into price_raw_text.
      // Anchoring to the start means only a span whose text actually begins
      // with the currency/period token can match.
      const priceParts = Array.from(anchor.querySelectorAll("span"))
        .map((s) => s.textContent?.trim() ?? "")
        .filter(Boolean);
      const priceRawText = priceParts.filter((p) => /^(RM|\/)/i.test(p)).join(" ").trim();
      const imageUrl = anchor.querySelector("img")?.getAttribute("src") ?? null;
      return { href: anchor.href, title, addressRaw, priceRawText, imageUrl };
    });

    const nextLink = Array.from(document.querySelectorAll("a")).find((a) => (a.textContent ?? "").trim() === "Next");
    const hasNextPage = Boolean(nextLink && nextLink.getAttribute("href"));

    return { cards, hasNextPage };
  });
}

export function roomzListingId(href: string): string {
  // /rent/room/{code}/{slug} — {code} is short and stable, confirmed unique
  // per listing (KL Roomz PRD §2).
  const match = href.match(/\/rent\/room\/([a-z0-9]+)\//i);
  return match ? match[1] : href;
}

export function buildLightweightRoomzRow(card: RoomzCard, now: string, crawlType: CrawlType): KlRoomzListingRow {
  return {
    listing_id: roomzListingId(card.href),
    source: "roomz",
    url: card.href,
    title: card.title,
    price_raw_text: card.priceRawText,
    address_raw: card.addressRaw,
    room_type_raw: null,
    bathroom_type_raw: null,
    lease_term_raw: null,
    gender_restriction_raw: null,
    occupation_raw: null,
    cooking_policy_raw: null,
    building_type_raw: null,
    furnishing_raw: null,
    size_raw: null,
    utilities_raw: null,
    deposit_line_items_raw: null,
    description_raw: null,
    availability_status_raw: null,
    refund_conditions_raw: null,
    tenant_preference_raw: null,
    image_urls: card.imageUrl ? [card.imageUrl] : null,
    scraped_at: now,
    crawl_type: crawlType,
  };
}

// ---- detail page ----

export interface RoomzDetailRaw {
  title: string;
  addressRaw: string | null;
  priceRawText: string;
  depositLineItems: { label: string; amountRaw: string }[] | null;
  descriptionRaw: string | null;
  roomTypeRaw: string | null;
  bathroomTypeRaw: string | null;
  leaseTermRaw: string | null;
  genderRestrictionRaw: string | null;
  occupationRaw: string | null;
  cookingPolicyRaw: string | null;
  buildingTypeRaw: string | null;
  furnishingRaw: string | null;
  sizeRaw: string | null;
  utilitiesRaw: string[] | null;
  imageUrls: string[] | null;
}

// Features is an unlabeled flat list (KL Roomz PRD §3) — each item is
// classified by shape/keyword, not by a sub-label (there isn't one). This is
// closed-set classification over a short, structurally-bounded list (the
// "Features" section only, never arbitrary free text), the same kind of
// positional/structural parsing Wetopia's extraction already does — not
// open-ended inference.
function classifyFeatureItem(item: string): Partial<RoomzDetailRaw> {
  if (/only$/i.test(item)) return { genderRestrictionRaw: item };
  if (/profession/i.test(item)) return { occupationRaw: item };
  if (/cooking/i.test(item)) return { cookingPolicyRaw: item };
  if (/contract/i.test(item)) return { leaseTermRaw: item };
  if (/sqft/i.test(item)) return { sizeRaw: item };
  if (/furnished/i.test(item)) return { furnishingRaw: item };
  if (/bathroom/i.test(item)) return { bathroomTypeRaw: item };
  if (/room$/i.test(item)) return { roomTypeRaw: item };
  return { buildingTypeRaw: item };
}

export async function extractRoomzDetailPage(page: Page): Promise<RoomzDetailRaw> {
  await page.waitForSelector("h1", { timeout: 15000 }).catch(() => {});

  return page.evaluate<RoomzDetailRaw>(() => {
    const lines = document.body.innerText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const title = document.querySelector("h1")?.textContent?.trim() ?? "";

    const priceMatch = lines.find((l) => /^RM\s/.test(l));
    const priceRawText = priceMatch
      ? `${priceMatch} ${lines[lines.indexOf(priceMatch) + 1] ?? ""}`.trim()
      : "";

    // Address: the line immediately after the title, if it doesn't look like
    // a section heading and isn't the "views" counter.
    const titleIdx = lines.indexOf(title);
    const addressRaw =
      titleIdx >= 0 && lines[titleIdx + 1] && /,/.test(lines[titleIdx + 1]) ? lines[titleIdx + 1] : null;

    // Section helper — bounded by a heading and whichever known heading comes
    // next, so a scan can't wander into unrelated parts of the page (used for
    // both the deposit table below and Features/Utilities further down).
    const HEADINGS = ["Deposit Detail", "Features", "Utilities", "Nearby", "Transportation", "Services", "Location"];
    function sectionItems(heading: string): string[] {
      const start = lines.indexOf(heading);
      if (start === -1) return [];
      const items: string[] = [];
      for (let i = start + 1; i < lines.length; i++) {
        if (HEADINGS.includes(lines[i])) break;
        items.push(lines[i]);
      }
      return items;
    }

    // Deposit table: generic "{label} :" -> next line is the value, scoped to
    // the "Deposit Detail" section specifically (not scanned across the
    // whole page, which could misattribute an unrelated "Label :"/"RM ..."
    // pair elsewhere as a deposit line item). Not hardcoded to "Rental
    // Deposit"/"Access Card Deposit" specifically (KL Roomz PRD §3 — the
    // label set isn't a confirmed fixed enum).
    const depositSectionLines = sectionItems("Deposit Detail");
    const depositLineItems: { label: string; amountRaw: string }[] = [];
    for (let i = 0; i < depositSectionLines.length; i++) {
      const m = depositSectionLines[i].match(/^(.+?)\s*:$/);
      if (m && depositSectionLines[i + 1] && /RM/.test(depositSectionLines[i + 1])) {
        depositLineItems.push({ label: m[1].trim(), amountRaw: depositSectionLines[i + 1].trim() });
      }
    }

    const featureItems = sectionItems("Features");
    const utilitiesRaw = sectionItems("Utilities");

    const classified: Partial<RoomzDetailRaw> = {};
    for (const item of featureItems) {
      Object.assign(classified, classifyFeatureItem(item));
    }

    const descIdx = lines.indexOf("Descriptions");
    const descriptionRaw = descIdx !== -1 && lines[descIdx + 1] ? lines[descIdx + 1] : null;

    const imageUrls = Array.from(document.querySelectorAll('img[src*="roomz-my-production"]'))
      .map((img) => img.getAttribute("src") ?? "")
      .filter(Boolean);

    return {
      title,
      addressRaw,
      priceRawText,
      depositLineItems: depositLineItems.length > 0 ? depositLineItems : null,
      descriptionRaw,
      roomTypeRaw: classified.roomTypeRaw ?? null,
      bathroomTypeRaw: classified.bathroomTypeRaw ?? null,
      leaseTermRaw: classified.leaseTermRaw ?? null,
      genderRestrictionRaw: classified.genderRestrictionRaw ?? null,
      occupationRaw: classified.occupationRaw ?? null,
      cookingPolicyRaw: classified.cookingPolicyRaw ?? null,
      buildingTypeRaw: classified.buildingTypeRaw ?? null,
      furnishingRaw: classified.furnishingRaw ?? null,
      sizeRaw: classified.sizeRaw ?? null,
      utilitiesRaw: utilitiesRaw.length > 0 ? utilitiesRaw : null,
      imageUrls: imageUrls.length > 0 ? [...new Set(imageUrls)] : null,
    };
  });
}

export function buildFullRoomzRow(
  detail: RoomzDetailRaw,
  listingId: string,
  url: string,
  now: string,
  crawlType: CrawlType,
): KlRoomzListingRow {
  return {
    listing_id: listingId,
    source: "roomz",
    url,
    title: detail.title,
    price_raw_text: detail.priceRawText,
    address_raw: detail.addressRaw,
    room_type_raw: detail.roomTypeRaw,
    bathroom_type_raw: detail.bathroomTypeRaw,
    lease_term_raw: detail.leaseTermRaw,
    gender_restriction_raw: detail.genderRestrictionRaw,
    occupation_raw: detail.occupationRaw,
    cooking_policy_raw: detail.cookingPolicyRaw,
    building_type_raw: detail.buildingTypeRaw,
    furnishing_raw: detail.furnishingRaw,
    size_raw: detail.sizeRaw,
    utilities_raw: detail.utilitiesRaw,
    deposit_line_items_raw: detail.depositLineItems,
    description_raw: detail.descriptionRaw,
    availability_status_raw: null, // no signal found on this source (KL Roomz PRD §3)
    refund_conditions_raw: null, // no per-listing concept found (KL Roomz PRD §3)
    tenant_preference_raw: null, // unconfirmed absence — no race/nationality field found in the samples checked
    image_urls: detail.imageUrls,
    scraped_at: now,
    crawl_type: crawlType,
  };
}

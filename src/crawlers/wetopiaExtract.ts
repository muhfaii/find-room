import type { Page } from "playwright";
import type { CrawlType, WetopiaListingRow } from "../types/klWetopiaListing.js";

// KL Wetopia PRD §3: property pages are built with the Breakdance page builder
// (WordPress) — no stable data-testid attributes and hashed/generated class
// names, the same situation as Mudah.my's Property Details grid. Unlike
// Mudah.my, there isn't even a small set of literal label strings to key off
// cleanly (Room Options blocks repeat with no per-field labels at all — just
// "Master Bedroom" / "Queen Bed" / "Private Bathroom" one after another). The
// most robust approach found is a sequential text-line parse of
// document.body.innerText, using "Room N" lines (a genuinely unique, unambiguous
// marker — confirmed live 2026-08-28) as anchors, and picking off the fields
// that follow it in fixed relative order. This is more fragile than the other
// KL sources' extraction — if Wetopia ever reorders the fields within a room
// block, this breaks silently. Re-verify against a live page if room data
// ever looks wrong after a Wetopia frontend change.

export interface WetopiaRoomRaw {
  index: number; // 1-based position in the Room Options list (ADR-0007's identity key)
  roomTypeRaw: string | null;
  bedTypeRaw: string | null;
  bathroomTypeRaw: string | null;
  amenitiesRaw: string[] | null;
  priceAmountRaw: string;
}

export interface WetopiaPropertyRaw {
  title: string;
  descriptionRaw: string | null;
  addressRaw: string | null;
  buildingFacilitiesRaw: string[] | null;
  sharedItemsRaw: string[] | null;
  imageUrls: string[] | null;
  rooms: WetopiaRoomRaw[];
}

const NAV_KEYWORDS = new Set(["Details", "Location", "Room Options", "Common Area", "Facilities", "Shared Items"]);

// Runs inside the page (via page.evaluate) — kept as a single function so both
// discovery and detail-refresh call the identical extraction logic (KL
// Wetopia PRD §2: this is a small, ~13-property catalog, so both crawl types
// re-scrape full property pages rather than needing a lightweight-card vs.
// full-detail split the way Mudah.my does).
export async function extractWetopiaPropertyPage(page: Page): Promise<WetopiaPropertyRaw> {
  await page.waitForSelector("body", { timeout: 15000 });

  return page.evaluate<WetopiaPropertyRaw>(() => {
    const lines = document.body.innerText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const NAV = new Set(["Details", "Location", "Room Options", "Common Area", "Facilities", "Shared Items"]);

    const title = (document.title || "").replace(/\s*\|\s*Wetopia Coliving\s*$/i, "").trim();

    let descriptionRaw: string | null = null;
    for (const l of lines) {
      if (l.length > 80 && !NAV.has(l)) {
        descriptionRaw = l;
        break;
      }
    }

    let addressRaw: string | null = null;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === "Location" && lines[i + 1] && !NAV.has(lines[i + 1]) && lines[i + 1].includes(",")) {
        addressRaw = lines[i + 1];
        break;
      }
    }

    const splitBullets = (line: string | undefined): string[] | null => {
      if (!line || !line.includes("•")) return null;
      const parts = line
        .split("•")
        .map((s) => s.trim())
        .filter(Boolean);
      return parts.length > 0 ? parts : null;
    };

    let buildingFacilitiesRaw: string[] | null = null;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === "Facilities" && splitBullets(lines[i + 1])) {
        buildingFacilitiesRaw = splitBullets(lines[i + 1]);
        break;
      }
    }

    let sharedItemsRaw: string[] | null = null;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === "Shared Items" && splitBullets(lines[i + 1])) {
        sharedItemsRaw = splitBullets(lines[i + 1]);
        break;
      }
    }

    const rooms: WetopiaRoomRaw[] = [];
    const roomLineRe = /^Room \d+$/;
    for (let i = 0; i < lines.length; i++) {
      if (!roomLineRe.test(lines[i])) continue;
      const roomTypeRaw = lines[i + 1] || null;
      const bedTypeRaw = lines[i + 2] || null;
      const bathroomTypeRaw = lines[i + 3] || null;
      const amenitiesRaw = splitBullets(lines[i + 4]);
      const priceAmountRaw = lines[i + 5] || "";
      rooms.push({
        index: rooms.length + 1,
        roomTypeRaw,
        bedTypeRaw,
        bathroomTypeRaw,
        amenitiesRaw,
        priceAmountRaw,
      });
    }

    const imageUrls = Array.from(document.querySelectorAll("img"))
      .map((img) => img.getAttribute("src") ?? "")
      .filter((src) => src && /\.(jpg|jpeg|png|webp)(\?|$)/i.test(src));

    return {
      title,
      descriptionRaw,
      addressRaw,
      buildingFacilitiesRaw,
      sharedItemsRaw,
      imageUrls: imageUrls.length > 0 ? [...new Set(imageUrls)] : null,
      rooms,
    };
  });
}

// Node-side, no page needed — builds the full row set for one property
// (ADR-0007: one row per room, synthesized id, shared property url).
export function buildWetopiaRows(
  propertySlug: string,
  propertyUrl: string,
  property: WetopiaPropertyRaw,
  now: string,
  crawlType: CrawlType,
): WetopiaListingRow[] {
  return property.rooms.map((room) => ({
    listing_id: `wetopia-${propertySlug}-room-${room.index}`,
    source: "wetopia" as const,
    url: propertyUrl,
    title: room.roomTypeRaw ? `${room.roomTypeRaw} @ ${property.title}` : property.title,
    price_amount_raw: room.priceAmountRaw,
    city_raw: property.addressRaw, // KL Wetopia PRD §3: no separate city/area field found — the scope guard and normalize step both work off the full address text
    area_raw: null,
    address_raw: property.addressRaw,
    room_type_raw: room.roomTypeRaw,
    bed_type_raw: room.bedTypeRaw,
    bathroom_type_raw: room.bathroomTypeRaw,
    room_amenities_raw: room.amenitiesRaw,
    building_facilities_raw: property.buildingFacilitiesRaw,
    shared_items_raw: property.sharedItemsRaw,
    description_raw: property.descriptionRaw,
    availability_status_raw: null, // no signal found on this source (KL Wetopia PRD §3)
    deposit_amount_raw: null, // confirmed likely-always-null (KL Wetopia PRD §3) — no per-room or per-property deposit figure found
    deposit_terms_raw: null,
    refund_conditions_raw: null, // site-wide refund page is a process form, not a per-listing figure
    tenant_preference_raw: null, // unconfirmed absence (KL Wetopia PRD §3) — no field found on sampled listings
    gender_restriction_raw: null, // same unconfirmed-absence caveat
    image_urls: property.imageUrls,
    scraped_at: now,
    crawl_type: crawlType,
  }));
}

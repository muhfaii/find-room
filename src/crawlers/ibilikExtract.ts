import type { Page } from "playwright";
import type { CrawlType, KlIbilikListingRow } from "../types/klIbilikListing.js";

// KL iBilik PRD §3: iBilik is a TanStack Start app — route data lives in
// window.__TSR_ROUTER__.state.matches[<last>].loaderData, not a __NEXT_DATA__
// blob. Search pages carry lightweight `cards`; detail pages carry the much
// richer `listing` object. Both are read the same way (last matched route's
// loaderData), just destructured differently by the caller.
async function readLastMatchLoaderData(page: Page): Promise<Record<string, unknown> | null> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __TSR_ROUTER__?: { state?: { matches?: unknown[] } } };
      const matches = w.__TSR_ROUTER__?.state?.matches;
      return Array.isArray(matches) && matches.length > 0;
    },
    { timeout: 20000 },
  );
  return page.evaluate(() => {
    const w = window as unknown as { __TSR_ROUTER__?: { state?: { matches?: { loaderData?: unknown }[] } } };
    const matches = w.__TSR_ROUTER__?.state?.matches ?? [];
    const last = matches[matches.length - 1];
    return (last?.loaderData as Record<string, unknown>) ?? null;
  });
}

// ---- search/discovery ----

export interface IbilikCard {
  id: string;
  href: string;
  title: string;
  description: string | null;
  images: { url: string }[] | null;
  currency: string | null;
  price: number | null;
  priceUnit: string | null;
  location: string | null;
}

export interface IbilikSearchPage {
  cards: IbilikCard[];
  totalPages: number;
}

export async function extractIbilikSearchPage(page: Page): Promise<IbilikSearchPage> {
  const loaderData = await readLastMatchLoaderData(page);
  const cards = Array.isArray(loaderData?.cards) ? (loaderData!.cards as IbilikCard[]) : [];
  const totalPages = typeof loaderData?.totalPages === "number" ? (loaderData!.totalPages as number) : 0;
  return { cards, totalPages };
}

export function ibilikDetailUrl(href: string): string {
  return href.startsWith("http") ? href : `https://www.ibilik.com${href}`;
}

// Combined "city, state" text for the scope guard — see buildFullIbilikRow's
// comment on why both taxonomy levels need to be in the checked string.
export function ibilikScopeText(row: KlIbilikListingRow): string | null {
  const parts = [row.area_raw, row.city_raw].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(", ") : row.address_raw;
}

// KL iBilik PRD §4: card-level data has no room_type/preferences/deposit
// fields — those only exist on the detail page. Discovery captures a
// lightweight row (same two-tier model as Mudah.my); detail-refresh fills in
// the rest, same division of labor.
export function buildLightweightIbilikRow(card: IbilikCard, now: string, crawlType: CrawlType): KlIbilikListingRow {
  const priceRawText =
    typeof card.price === "number" ? `${card.currency ?? "RM"} ${card.price} per ${card.priceUnit ?? "month"}` : "";
  return {
    listing_id: card.id,
    source: "ibilik",
    url: ibilikDetailUrl(card.href),
    title: card.title ?? "",
    price_amount: typeof card.price === "number" ? card.price : null,
    price_raw_text: priceRawText,
    city_raw: null,
    area_raw: null,
    address_raw: card.location ?? null,
    latitude: null,
    longitude: null,
    room_type_raw: null,
    bathroom_type_raw: null,
    facilities_raw: null,
    description_raw: card.description ?? null,
    availability_status_raw: null,
    deposit_amount_raw: null,
    deposit_terms_raw: null,
    refund_conditions_raw: null,
    tenant_preference_raw: null,
    gender_restriction_raw: null,
    min_rental_duration_raw: null,
    rating: null,
    review_count: null,
    image_urls: Array.isArray(card.images) ? card.images.map((i) => i.url).filter(Boolean) : null,
    scraped_at: now,
    crawl_type: crawlType,
  };
}

// ---- detail page ----

interface IbilikPreferenceEntry {
  preference: {
    type: string; // "GENERAL" | "LEASE_TERM" | "NATIONALITY" | "OCCUPATION" | "RACE" | "STATUS"
    code: string;
    locales?: Record<string, { name?: string }>;
  };
}

interface IbilikRatePlan {
  name: string;
  chargeUnit: string;
  chargeAmount: number;
  currency: string;
}

export interface IbilikListingDetail {
  id: string;
  slug: string;
  locales: Record<string, { title?: string; description?: string }>;
  type: string; // "ROOM" | "ELDERLY_CARE" | ...
  status: string | null;
  latitude: number | null;
  longitude: number | null;
  region?: { locales?: Record<string, { name?: string }> } | null;
  state?: { locales?: Record<string, { name?: string }> } | null;
  city?: { locales?: Record<string, { name?: string }> } | null;
  area?: { locales?: Record<string, { name?: string }> } | null;
  address: string | null;
  amenities?: { amenity?: { locales?: Record<string, { name?: string }> } }[] | null;
  utilities?: { utility?: { locales?: Record<string, { name?: string }> } }[] | null;
  images?: { url: string }[] | null;
  preferences?: IbilikPreferenceEntry[] | null;
  ratePlans?: IbilikRatePlan[] | null;
  longTermRoomRentalListing?: { roomType?: string | null; bathroomType?: string | null } | null;
}

export async function extractIbilikListingDetail(page: Page): Promise<IbilikListingDetail | null> {
  const loaderData = await readLastMatchLoaderData(page);
  return (loaderData?.listing as IbilikListingDetail) ?? null;
}

function localeName(entity: { locales?: Record<string, { name?: string }> } | null | undefined): string | null {
  return entity?.locales?.["en-US"]?.name ?? null;
}

function mergeAmenityLabels(listing: IbilikListingDetail): string[] | null {
  const labels: string[] = [];
  for (const a of listing.amenities ?? []) {
    const name = localeName(a.amenity);
    if (name) labels.push(name);
  }
  for (const u of listing.utilities ?? []) {
    const name = localeName(u.utility);
    if (name) labels.push(name);
  }
  return labels.length > 0 ? labels : null;
}

// ADR-0008: preferences are destructured by `type`, never spread or iterated
// generically as one blob. RACE/NATIONALITY/OCCUPATION/GENERAL become a
// read-only display string (deterministic templating over already-typed
// values — same precedent as speedhomeExtract.ts's
// serializeTenantPreferenceRaw); STATUS and LEASE_TERM are extracted
// separately as raw codes for normalize to map into gender_restriction /
// min_rental_duration_months (ADR-0008) — they do NOT go into the display
// string, to avoid duplicating the same fact in two places.
function extractPreferences(listing: IbilikListingDetail): {
  tenantPreferenceRaw: string | null;
  genderRestrictionRaw: string | null;
  minRentalDurationRaw: string | null;
} {
  const prefs = listing.preferences ?? [];
  const displayParts: string[] = [];
  let genderRestrictionRaw: string | null = null;
  let minRentalDurationRaw: string | null = null;

  for (const entry of prefs) {
    const { type, code } = entry.preference;
    const name = entry.preference.locales?.["en-US"]?.name ?? code;
    switch (type) {
      case "STATUS":
        genderRestrictionRaw = code;
        break;
      case "LEASE_TERM":
        minRentalDurationRaw = code;
        break;
      case "RACE":
        displayParts.push(`Race preference: ${name}`);
        break;
      case "NATIONALITY":
        displayParts.push(`Nationality preference: ${name}`);
        break;
      case "OCCUPATION":
        displayParts.push(`Occupation preference: ${name}`);
        break;
      case "GENERAL":
        // KL iBilik PRD §6: GENERAL codes look like internal platform/landlord
        // soft-preference flags (prefer-zero-deposit, preferred-listing),
        // not tenant-facing screening criteria — surfaced verbatim for
        // completeness, not specially worded like the others.
        displayParts.push(name);
        break;
      default:
        break;
    }
  }

  return {
    tenantPreferenceRaw: displayParts.length > 0 ? displayParts.join("; ") : null,
    genderRestrictionRaw,
    minRentalDurationRaw,
  };
}

function extractDepositRatePlan(listing: IbilikListingDetail): { amountRaw: string | null; termsRaw: string | null } {
  const deposit = (listing.ratePlans ?? []).find((p) => /deposit/i.test(p.name));
  if (!deposit) return { amountRaw: null, termsRaw: null };
  return { amountRaw: String(deposit.chargeAmount), termsRaw: deposit.name };
}

export function buildFullIbilikRow(
  listing: IbilikListingDetail,
  now: string,
  crawlType: CrawlType,
): KlIbilikListingRow {
  const title = listing.locales?.["en-US"]?.title ?? "";
  const description = listing.locales?.["en-US"]?.description ?? null;
  const monthlyRate = (listing.ratePlans ?? []).find((p) => /rent/i.test(p.name));
  const priceAmount = monthlyRate ? monthlyRate.chargeAmount : null;
  const priceRawText = monthlyRate ? `${monthlyRate.currency} ${monthlyRate.chargeAmount} per month` : "";
  const { amountRaw: depositAmountRaw, termsRaw: depositTermsRaw } = extractDepositRatePlan(listing);
  const { tenantPreferenceRaw, genderRestrictionRaw, minRentalDurationRaw } = extractPreferences(listing);

  // KL iBilik PRD §3: iBilik's own taxonomy is 3 levels (state > city > area),
  // and confusingly "Kuala Lumpur" is a STATE name that covers many
  // city-level sub-districts (Cheras, Wangsa Maju, ...) that don't literally
  // contain the text "Kuala Lumpur" anywhere. city_raw/area_raw are kept as
  // "city, state" (e.g. "Cheras, Kuala Lumpur" / "Petaling Jaya, Selangor")
  // specifically so isInKlangValleyScope's substring match works regardless
  // of which taxonomy level actually names one of the 7 target cities —
  // matching against state name catches every KL sub-district, matching
  // against city name catches every Selangor target city.
  const stateName = localeName(listing.state);
  const cityName = localeName(listing.city);
  return {
    listing_id: listing.id,
    source: "ibilik",
    url: ibilikDetailUrl(`/room-rentals/${listing.id}/${listing.slug}`),
    title,
    price_amount: priceAmount,
    price_raw_text: priceRawText,
    city_raw: stateName,
    area_raw: cityName,
    address_raw: listing.address ?? ([cityName, stateName].filter(Boolean).join(", ") || null),
    latitude: listing.latitude,
    longitude: listing.longitude,
    room_type_raw: listing.longTermRoomRentalListing?.roomType ?? null,
    bathroom_type_raw: listing.longTermRoomRentalListing?.bathroomType ?? null,
    facilities_raw: mergeAmenityLabels(listing),
    description_raw: description,
    availability_status_raw: listing.status,
    deposit_amount_raw: depositAmountRaw,
    deposit_terms_raw: depositTermsRaw,
    refund_conditions_raw: null, // no such concept found on this source (KL iBilik PRD §5)
    tenant_preference_raw: tenantPreferenceRaw,
    gender_restriction_raw: genderRestrictionRaw,
    min_rental_duration_raw: minRentalDurationRaw,
    rating: null,
    review_count: null,
    image_urls: Array.isArray(listing.images) ? listing.images.map((i) => i.url).filter(Boolean) : null,
    scraped_at: now,
    crawl_type: crawlType,
  };
}

// The fixed discovery seed list (KL Speedhome PRD §2, §4): the 7 Klang Valley
// cities, room listings only.
//
// Unlike Mudah.my (two URL shapes depending on administrative level — see
// src/config/klMudah.ts), Speedhome uses one uniform pattern for all 7 cities:
//   https://speedhome.com/rent/{city-slug}/room
// All 7 confirmed live 2026-08-28 (real browser request — plain curl/WebFetch
// gets HTTP 403 from Cloudflare bot protection even though robots.txt allows
// these paths, same situation as Mudah.my):
//   kuala-lumpur   -> "91 Zero Deposit Rooms for Rent in Kuala Lumpur"
//   petaling-jaya  -> "36 Zero Deposit Rooms for Rent in Petaling Jaya"
//   ampang         -> "16 Zero Deposit Rooms for Rent in Ampang"
//   subang-jaya    -> (linked in nav; not individually counted)
//   shah-alam      -> (linked in nav; not individually counted)
//   bangi          -> "8 Zero Deposit Rooms for Rent in Bangi"
//   putrajaya      -> "19 Zero Deposit Rooms for Rent in Putrajaya"
//
// "ampang" (not "ampang-jaya") is the correct slug — same "Ampang Jaya
// listings are labeled/slugged as plain Ampang" fact as Mudah.my, confirmed
// independently on this source too (see src/config/klangValley.ts).
//
// The `/room` suffix is the confirmed category filter (KL Speedhome PRD §1):
// Speedhome's `type` field takes 3 values (HIGHRISE, ROOM, LANDED); the
// unfiltered /rent/{city} page mixes all three, /rent/{city}/room returns
// ROOM only. Still re-verify `type === "ROOM"` per listing during extraction
// (KL Speedhome PRD §5) rather than trusting the seed URL alone.
export const KL_SPEEDHOME_SEEDS = [
  { cityLabel: "Kuala Lumpur", seedUrl: "https://speedhome.com/rent/kuala-lumpur/room" },
  { cityLabel: "Petaling Jaya", seedUrl: "https://speedhome.com/rent/petaling-jaya/room" },
  { cityLabel: "Ampang Jaya", seedUrl: "https://speedhome.com/rent/ampang/room" },
  { cityLabel: "Subang Jaya", seedUrl: "https://speedhome.com/rent/subang-jaya/room" },
  { cityLabel: "Shah Alam", seedUrl: "https://speedhome.com/rent/shah-alam/room" },
  { cityLabel: "Bangi", seedUrl: "https://speedhome.com/rent/bangi/room" },
  { cityLabel: "Putrajaya", seedUrl: "https://speedhome.com/rent/putrajaya/room" },
] as const;

export type KlSpeedhomeCityLabel = (typeof KL_SPEEDHOME_SEEDS)[number]["cityLabel"];

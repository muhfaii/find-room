import type { KlListingRow } from "./klListing.js";
import type { SpeedhomeListingRow } from "./klSpeedhomeListing.js";
import type { WetopiaListingRow } from "./klWetopiaListing.js";
import type { KlIbilikListingRow } from "./klIbilikListing.js";
import type { KlRoomzListingRow } from "./klRoomzListing.js";

// The KL ingest client (src/lib/ingestClientKl.ts) is deployment-level, not
// source-level — it just POSTs whatever row shape a KL crawler hands it to the
// one shared KL ingest worker, which dispatches on `row.source` (see
// workers/ingest-kl/src/index.ts). This union is that "whatever row shape"
// contract. Add a new arm here — never widen the individual source row types
// themselves — when a new KL source is added.
export type KlAnyListingRow =
  | KlListingRow
  | SpeedhomeListingRow
  | WetopiaListingRow
  | KlIbilikListingRow
  | KlRoomzListingRow;

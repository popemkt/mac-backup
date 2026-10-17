/**
 * The locations family's declaration (DESIGN.md → Locations), the one home
 * of its name. It provides no view: its nodes live in the person's home
 * store, minted there by the first register, and its picker is the page's
 * sidebar and command palette. It seeds only the palette's command.
 * Optional, and on by default.
 */
import { defineExtension } from "@kb/contracts";
import { locationsSeedNodes } from "./seed.ts";

export const locationsExtension = defineExtension({
  name: "locations",
  label: "Locations",
  optional: { byDefault: "on" },
  seed: locationsSeedNodes,
});

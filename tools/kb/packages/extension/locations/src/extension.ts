/**
 * The locations family's declaration (DESIGN.md → Locations), the one home
 * of its name. It seeds nothing and provides no view: its nodes live in the
 * person's home store, minted there by the first register, and its picker is
 * the page's sidebar and command palette. Optional, and on by default.
 */
import { defineExtension } from "@kb/contracts";

export const locationsExtension = defineExtension({
  name: "locations",
  label: "Locations",
  optional: { byDefault: "on" },
});

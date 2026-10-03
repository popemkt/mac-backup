/**
 * Core declared as the families are (DESIGN.md → Extension families): its
 * own system nodes and the views the shell is built from. It is the first
 * declaration the seed fold reads.
 *
 * It still lists the feature views beside its own: GAP [[01M41H30342XZPX3CXZJTMPBYW]]
 */
import { defineExtension } from "@kb/contracts";
import { systemSeedNodes } from "@kb/model";
import { VIEW_CATALOG } from "@kb/views";

export const coreExtension = defineExtension({
  name: "core",
  label: "Core",
  seed: systemSeedNodes,
  views: VIEW_CATALOG.map((key) => ({ key })),
});

/**
 * The locations family's seed: its ⌘K command, "Open location…", declared
 * the way core declares its own commands. The bundled seed folds it after
 * core's nodes (DESIGN.md → Extension families → the seed is the bundled
 * fold).
 */
import { seededCommand, type KbNode } from "@kb/model";
import { LOCATION_IDS } from "./ids.ts";

export function locationsSeedNodes(at: string): readonly KbNode[] {
  return [seededCommand(LOCATION_IDS.openCommand, "Open location…", at)];
}

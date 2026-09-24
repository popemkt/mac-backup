import type { WireNode } from "@kb/contracts";
import { systemSeedNodes } from "@kb/model";
import { SYSTEM_IDS } from "@/lib/types";

const at = "2026-09-06T00:00:00.000Z";

const SEED = new Map(systemSeedNodes(at).map((seed) => [seed.id, seed]));

/** A view field as the seed declares it — its value type included — minus its option children. */
function field(id: string): WireNode {
  const seed = SEED.get(id);
  if (seed === undefined) throw new Error(`view fixture names an unseeded field: ${id}`);
  return { id, text: id, props: seed.props, children: [], createdAt: at, updatedAt: at };
}

/** Field nodes required by synthetic graphs that exercise view mutations. */
export const viewFieldNodes = [
  SYSTEM_IDS.viewModeField,
  SYSTEM_IDS.viewSortField,
  SYSTEM_IDS.viewSortDirField,
  SYSTEM_IDS.viewDisplayField,
  SYSTEM_IDS.viewColwidthField,
  SYSTEM_IDS.viewPagesizeField,
  SYSTEM_IDS.viewGroupField,
  SYSTEM_IDS.viewFilterField,
  SYSTEM_IDS.lensRendererField,
].map(field);

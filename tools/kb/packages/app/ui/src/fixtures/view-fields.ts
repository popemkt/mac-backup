import type { WireNode } from "@kb/contracts";
import { SYSTEM_IDS } from "@/lib/types";

const at = "2026-09-06T00:00:00.000Z";

function field(id: string): WireNode {
  return {
    id,
    text: id,
    props: { [SYSTEM_IDS.typeField]: [{ t: "ref", v: SYSTEM_IDS.field }] },
    children: [],
    createdAt: at,
    updatedAt: at,
  };
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

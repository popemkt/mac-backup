/**
 * The outline's own global commands, contributed through `CommandPoint`: the
 * `sys.command` nodes "Expand all" and "Collapse all" open or close every
 * row under the zoom, which only the outline holds. The registry finds them
 * by id like any other.
 */
import { SYSTEM_IDS, type Command } from "@kb/ui-sdk";
import { useOutlineStore } from "./outline.store";

export const OUTLINE_COMMANDS: readonly Command[] = [
  {
    id: SYSTEM_IDS.cmdExpandAll,
    scope: "global",
    run: () => useOutlineStore.getState().expandAllInScope(),
  },
  {
    id: SYSTEM_IDS.cmdCollapseAll,
    scope: "global",
    run: () => useOutlineStore.getState().collapseAllInScope(),
  },
];

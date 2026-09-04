import type { NodeMap } from "@/lib/types";
import { getViewConfig, isProjectedViewMode } from "@/lib/view-config";
import { useOutlineStore } from "@/stores/outline.store";
import { BoardCardsView } from "./board-cards-view";
import { TableView } from "./table-view";

interface FrameChildrenViewProps {
  frameId: string;
  frameInstanceKey?: string;
  nodes?: NodeMap;
  /** Query-result row ids — when set, render as ref instances. */
  rowIds?: string[];
  isQuerySource?: boolean;
}

/**
 * Shared dispatcher for table / board / cards on hierarchy or query frames.
 * Returns null for list mode (caller renders NodeBlocks).
 */
export function FrameChildrenView({
  frameId,
  frameInstanceKey,
  nodes: nodesProp,
  rowIds,
  isQuerySource = false,
}: FrameChildrenViewProps) {
  const storeNodes = useOutlineStore((s) => s.nodes);
  const nodes = nodesProp ?? storeNodes;
  const frame = nodes.get(frameId);
  const viewConfig = getViewConfig(frame?.props);

  if (!isProjectedViewMode(viewConfig.mode)) return null;

  if (viewConfig.mode === "table") {
    return (
      <TableView
        frameId={frameId}
        frameInstanceKey={frameInstanceKey}
        nodes={nodes}
        rowIds={rowIds}
        isQuerySource={isQuerySource}
      />
    );
  }

  if (viewConfig.mode !== "board" && viewConfig.mode !== "cards") {
    return null;
  }

  return (
    <BoardCardsView
      frameId={frameId}
      frameInstanceKey={frameInstanceKey}
      nodes={nodes}
      rowIds={rowIds}
      isQuerySource={isQuerySource}
    />
  );
}

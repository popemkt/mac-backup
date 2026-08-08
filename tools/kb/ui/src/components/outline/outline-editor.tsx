import { useOutlineStore } from "@/stores/outline.store";
import { WORKSPACE_ROOT_ID } from "@/lib/types";
import { Breadcrumbs } from "./breadcrumbs";
import { NodeBlock } from "./node-block";
import { useSelectionKeymap } from "./use-selection-keymap";

export function OutlineEditor() {
  const rootNodeId = useOutlineStore((s) => s.rootNodeId);
  const root = useOutlineStore((s) => s.nodes.get(s.rootNodeId));
  useSelectionKeymap();

  if (!root) {
    return (
      <div className="px-2 py-8 text-[13px] text-[var(--kb-muted)]">
        Loading outline…
      </div>
    );
  }

  // When zoomed into a node, render that node as the top row then its children
  if (rootNodeId !== WORKSPACE_ROOT_ID) {
    return (
      <div className="outline-editor px-1 pb-16">
        <Breadcrumbs />
        <NodeBlock nodeId={rootNodeId} depth={0} />
      </div>
    );
  }

  return (
    <div className="outline-editor px-1 pb-16">
      <Breadcrumbs />
      {root.children.map((id) => (
        <NodeBlock key={id} nodeId={id} depth={0} />
      ))}
    </div>
  );
}

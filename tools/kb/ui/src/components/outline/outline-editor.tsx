import { WORKSPACE_ROOT_ID } from "@/lib/types";
import { useOutlineStore } from "@/stores/outline.store";
import { useUiStore } from "@/stores/ui.store";
import { Breadcrumbs } from "./breadcrumbs";
import { GhostNodeRow } from "./ghost-node-row";
import { NodeBlock } from "./node-block";
import { NodeCommandPalette } from "./node-command-palette";
import { ReferencesSection } from "./references-section";
import { SchemaSection } from "./schema-section";
import { ZoomedRootHeader } from "./zoomed-root-header";
import { useSelectionKeymap } from "./use-selection-keymap";

export function OutlineEditor() {
  const rootNodeId = useOutlineStore((s) => s.rootNodeId);
  const root = useOutlineStore((s) => s.nodes.get(s.rootNodeId));
  const nodePaletteOpen = useUiStore((s) => s.nodePaletteOpen);
  const setNodePaletteOpen = useUiStore((s) => s.setNodePaletteOpen);
  useSelectionKeymap();

  if (!root) {
    return (
      <div className="px-2 py-8 text-[13px] text-foreground/50">
        Loading outline…
      </div>
    );
  }

  if (rootNodeId !== WORKSPACE_ROOT_ID) {
    return (
      <div className="outline-editor px-2 pb-40">
        <Breadcrumbs />
        <ZoomedRootHeader node={root} />
        {root.children.map((id) => (
          <NodeBlock key={id} nodeId={id} depth={0} />
        ))}
        <GhostNodeRow
          depth={0}
          parentId={rootNodeId}
          afterSiblingId={
            root.children.length > 0
              ? root.children[root.children.length - 1]!
              : null
          }
        />
        <SchemaSection nodeId={rootNodeId} />
        <ReferencesSection nodeId={rootNodeId} />
        <NodeCommandPalette
          open={nodePaletteOpen}
          onClose={() => setNodePaletteOpen(false)}
        />
      </div>
    );
  }

  return (
    <div className="outline-editor px-2 pb-40">
      <Breadcrumbs />
      {root.children.map((id) => (
        <NodeBlock key={id} nodeId={id} depth={0} />
      ))}
      <GhostNodeRow
        depth={0}
        parentId={WORKSPACE_ROOT_ID}
        afterSiblingId={
          root.children.length > 0
            ? root.children[root.children.length - 1]!
            : null
        }
      />
      <NodeCommandPalette
        open={nodePaletteOpen}
        onClose={() => setNodePaletteOpen(false)}
      />
    </div>
  );
}

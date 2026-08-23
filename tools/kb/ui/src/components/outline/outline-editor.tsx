import { useCallback, useEffect } from "react";
import { outlineInstanceKey } from "@/lib/instance-key";
import { WORKSPACE_ROOT_ID } from "@/lib/types";
import { applyViewFilters, getViewConfig, isProjectedViewMode } from "@/lib/view-config";
import { useOutlineStore } from "@/stores/outline.store";
import { useUiStore } from "@/stores/ui.store";
import { mutations } from "@/actions/mutations";
import { Breadcrumbs } from "./breadcrumbs";
import { FrameChildrenView } from "./frame-children-view";
import { NodeBlock } from "./node-block";
import { NodeCommandPalette } from "./node-command-palette";
import { ReferencesSection } from "./references-section";
import { SchemaSection } from "./schema-section";
import { ZoomedRootHeader } from "./zoomed-root-header";
import { useSelectionKeymap } from "./use-selection-keymap";

/**
 * Home (`__kb_root__`) is a virtual node with empty props — view.mode cannot
 * persist there, so home always renders the list of forest roots. Projected
 * views are available on zoomed/nested frames via ViewToolbar.
 */
export function OutlineEditor() {
  const rootNodeId = useOutlineStore((s) => s.rootNodeId);
  const root = useOutlineStore((s) => s.nodes.get(s.rootNodeId));
  const nodes = useOutlineStore((s) => s.nodes);
  const nodePaletteOpen = useUiStore((s) => s.nodePaletteOpen);
  const setNodePaletteOpen = useUiStore((s) => s.setNodePaletteOpen);
  useSelectionKeymap();
  useUndoRedoKeymap();

  /**
   * Container background is NOT a create target — only the explicit strip is (F14).
   * The zoomed container click is removed entirely; the strip has its own guard-free handler (F1).
   */
  const handleStripCreate = useCallback(() => {
    const store = useOutlineStore.getState();
    void mutations.createTransientNode(
      rootNodeId,
      store.nodes.get(rootNodeId)?.children.slice(-1)[0] ?? null,
    );
  }, [rootNodeId]);

  if (!root) {
    return <div className="px-2 py-8 text-[13px] text-foreground/50">Loading outline…</div>;
  }

  if (rootNodeId !== WORKSPACE_ROOT_ID) {
    const viewConfig = getViewConfig(root.props);
    const projected = isProjectedViewMode(viewConfig.mode);
    const listKids = projected
      ? []
      : applyViewFilters(
          root.children
            .map((id) => nodes.get(id))
            .filter((n): n is NonNullable<typeof n> => n !== undefined),
          viewConfig.filters,
          nodes,
        );

    return (
      <div className="outline-editor px-2 pb-40">
        <Breadcrumbs />
        <ZoomedRootHeader node={root} />

        {projected ? (
          <FrameChildrenView frameId={rootNodeId} />
        ) : (
          listKids.map((child) => {
            const key = outlineInstanceKey(child.id, nodes);
            return <NodeBlock key={key} nodeId={child.id} instanceKey={key} depth={0} />;
          })
        )}

        {!projected && (
          <div
            data-create-child-zone={rootNodeId}
            className="group/create flex h-8 cursor-pointer items-center pl-6"
            onClick={handleStripCreate}
            title="New node"
          >
            <span className="text-[13px] leading-none text-foreground/0 transition-colors duration-150 group-hover/create:text-foreground/25">
              +
            </span>
          </div>
        )}
        <SchemaSection nodeId={rootNodeId} />
        <ReferencesSection nodeId={rootNodeId} />
        <NodeCommandPalette open={nodePaletteOpen} onClose={() => setNodePaletteOpen(false)} />
      </div>
    );
  }

  return (
    <div className="outline-editor px-2 pb-40">
      <Breadcrumbs />

      {root.children.map((id) => {
        const key = outlineInstanceKey(id, nodes);
        return <NodeBlock key={key} nodeId={id} instanceKey={key} depth={0} />;
      })}

      <div
        data-create-child-zone={WORKSPACE_ROOT_ID}
        className="group/create flex h-8 cursor-pointer items-center pl-6"
        onClick={handleStripCreate}
        title="New node"
      >
        <span className="text-[13px] leading-none text-foreground/0 transition-colors duration-150 group-hover/create:text-foreground/25">
          +
        </span>
      </div>
      <NodeCommandPalette open={nodePaletteOpen} onClose={() => setNodePaletteOpen(false)} />
    </div>
  );
}

/**
 * D19: Cmd/Ctrl+Z / Shift variants drive the action-level undo stack while
 * focus is outside a text editor; inside editors native text undo wins.
 */
function useUndoRedoKeymap(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.key.toLowerCase() !== "z") return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      if (e.shiftKey) void mutations.redo();
      else void mutations.undo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

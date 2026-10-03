import { useCallback, useEffect } from "react";
import { WORKSPACE_ROOT_ID } from "@/lib/types";
import { projectsRows } from "@kb/views";
import { useOutlineStore } from "@/stores/outline.store";
import { useUiStore } from "@/stores/ui.store";
import { mutations } from "@/actions/mutations";
import { Breadcrumbs } from "./breadcrumbs";
import { FrameViewSlot } from "./frame-view-slot";
import { useSlotChain } from "@/components/ui/slot-chain";
import { useFrameView } from "./use-frame-views";
import { NodeCommandPalette } from "./node-command-palette";
import { ReferencesSection } from "./references-section";
import { SchemaSection } from "./schema-section";
import { isTextEntry } from "@/lib/dom";
import { HeaderWash, ZoomedRootHeader } from "./zoomed-root-header";
import { useSelectionKeymap } from "./use-selection-keymap";
import { setOutlineHost } from "@/stores/outline-hosts";
import { useLeadsOutlines, useOutlineHost } from "./outline-host";

/**
 * Home (`__kb_root__`) is a virtual node with empty props — view.mode cannot
 * persist there, so home always renders the list of forest roots. Projected
 * views are available on zoomed/nested frames via ViewToolbar.
 */
export function OutlineEditor({ root: rootProp }: { readonly root?: string | undefined }) {
  // Rooted at its own node in a pane, else at the outline's zoom.
  const zoomRoot = useOutlineStore((s) => s.rootNodeId);
  const rootNodeId = rootProp ?? zoomRoot;
  const root = useOutlineStore((s) => s.nodes.get(rootNodeId));
  const rootView = useFrameView(root);
  // The keyboard walk of this outline's rows starts where its root frame's slot does.
  const host = useOutlineHost();
  const slotChain = useSlotChain();
  useEffect(() => {
    setOutlineHost(host, { root: rootProp ?? null, chain: slotChain });
    return () => setOutlineHost(host, null);
  }, [host, rootProp, slotChain]);
  const leads = useLeadsOutlines();

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
    return (
      <div
        className="px-2 py-8 text-ui text-foreground/50"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        Loading outline…
      </div>
    );
  }

  // The root is a frame like any other: its view shows its rows, whether it is
  // the workspace root or a zoomed-in node.
  const projected = projectsRows(rootView?.key ?? null);
  const rootRows = <FrameViewSlot frameId={rootNodeId} depth={0} />;

  if (rootNodeId !== WORKSPACE_ROOT_ID) {
    return (
      <div className="outline-editor px-2 pb-40">
        <Breadcrumbs root={rootProp} />
        <ZoomedRootHeader node={root} view={rootView?.key ?? null} />

        {rootRows}

        {!projected && (
          <div
            data-create-child-zone={rootNodeId}
            role="button"
            tabIndex={0}
            aria-label="New node"
            className="group/create flex h-8 cursor-pointer items-center rounded-sm pl-6 outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            onClick={handleStripCreate}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleStripCreate();
              }
            }}
            title="New node"
          >
            <span className="text-ui leading-none text-foreground/0 transition-colors duration-150 group-hover/create:text-foreground/25 group-focus-visible/create:text-foreground/25">
              +
            </span>
          </div>
        )}
        <SchemaSection nodeId={rootNodeId} />
        <ReferencesSection nodeId={rootNodeId} />
        {leads ? <OutlinePageKeys /> : null}
      </div>
    );
  }

  return (
    <div className="outline-editor px-2 pb-40">
      <div className="relative">
        <HeaderWash color="var(--primary)" />
        <div className="relative">
          <Breadcrumbs root={rootProp} />
        </div>
      </div>

      {rootRows}

      <div
        data-create-child-zone={WORKSPACE_ROOT_ID}
        role="button"
        tabIndex={0}
        aria-label="New node"
        className="group/create flex h-8 cursor-pointer items-center rounded-sm pl-6 outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        onClick={handleStripCreate}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleStripCreate();
          }
        }}
        title="New node"
      >
        <span className="text-ui leading-none text-foreground/0 transition-colors duration-150 group-hover/create:text-foreground/25 group-focus-visible/create:text-foreground/25">
          +
        </span>
      </div>
      {leads ? <OutlinePageKeys /> : null}
    </div>
  );
}

/**
 * What editing an outline adds to the page once, however many outlines are
 * on screen: the selection keymap, undo and redo, and the node palette. The
 * outline that leads renders it (`useLeadsOutlines`).
 */
function OutlinePageKeys() {
  const nodePaletteOpen = useUiStore((s) => s.nodePaletteOpen);
  const setNodePaletteOpen = useUiStore((s) => s.setNodePaletteOpen);
  useSelectionKeymap();
  useUndoRedoKeymap();
  return <NodeCommandPalette open={nodePaletteOpen} onClose={() => setNodePaletteOpen(false)} />;
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
      if (isTextEntry(e.target)) return;
      e.preventDefault();
      if (e.shiftKey) void mutations.redo();
      else void mutations.undo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

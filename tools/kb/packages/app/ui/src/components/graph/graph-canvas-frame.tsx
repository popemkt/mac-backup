import { useEffect, useMemo, useRef } from "react";
import { isGraphShortcutTarget } from "@/lib/graph-interaction";
import type { LensNode, LensPerspective, LensRenderer } from "@/lib/graph-lens";
import { GraphLegend } from "./graph-legend";
import { GraphToolbar } from "./graph-toolbar";
import { GraphCanvasError, GraphCanvasErrorBoundary } from "./graph-canvas-error";
import { GraphSelectionCard } from "./graph-selection-card";
import { capabilitiesFor } from "./graph-capabilities";
import type { GraphCameraControls } from "./graph-camera-controls";
import type { GraphSelection } from "./graph-selection";
import { hasText } from "@/lib/text";

/** Shared graph chrome. Renderers only own pixels and renderer-specific input;
 * the frame owns the discoverable vocabulary that surrounds every graph. */
export function GraphCanvasFrame({
  children,
  nodes,
  renderer,
  controls,
  selectedNodeId,
  selection,
  onClearSelection,
  onOpenNode,
  onSearchChange,
  onFilterChange,
  queryError,
  resetKey,
  perspective,
}: {
  children: React.ReactNode;
  nodes: LensNode[];
  renderer: LensRenderer;
  controls: GraphCameraControls | null;
  selectedNodeId: string | null;
  selection: GraphSelection | null;
  onClearSelection: () => void;
  onOpenNode: (id: string) => void;
  onSearchChange: (ids: Set<string> | null) => void;
  onFilterChange: (ids: Set<string> | null) => void;
  /** Surfaces resolveNodeSet failures inside the canvas (task 16c). */
  queryError?: string | null;
  resetKey?: string;
  perspective?: LensPerspective | null;
}) {
  const capabilities = capabilitiesFor(renderer);
  const searchNodes = useMemo(() => nodes.map((n) => ({ id: n.id, label: n.label })), [nodes]);
  const clearRef = useRef(onClearSelection);
  clearRef.current = onClearSelection;

  useEffect(() => {
    if (!capabilities.selection) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isGraphShortcutTarget(e.target)) return;
      if (e.key === "Escape") clearRef.current();
      if (e.key === "Enter" && selectedNodeId !== null) onOpenNode(selectedNodeId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [capabilities.selection, selectedNodeId, onOpenNode]);

  return (
    <>
      {hasText(queryError) ? (
        <GraphCanvasError title="Graph query error" message={queryError} />
      ) : (
        <GraphCanvasErrorBoundary resetKey={resetKey ?? renderer}>
          {children}
        </GraphCanvasErrorBoundary>
      )}
      <GraphToolbar
        capabilities={capabilities}
        controls={controls}
        selectedNodeId={selectedNodeId}
        nodes={searchNodes}
        onSearchChange={onSearchChange}
        perspective={perspective}
      />
      <GraphLegend nodes={nodes} onFilterChange={onFilterChange} />
      {controls?.expandAll && controls.collapseAll ? (
        <div className="absolute bottom-3 left-3 z-20 flex gap-1 rounded-lg border border-foreground/10 bg-popover/95 p-1 text-xs shadow">
          <button
            type="button"
            className="rounded px-2 py-1 hover:bg-foreground/5"
            onClick={controls.collapseAll}
          >
            Collapse all
          </button>
          <button
            type="button"
            className="rounded px-2 py-1 hover:bg-foreground/5"
            onClick={controls.expandAll}
          >
            Expand all
          </button>
        </div>
      ) : null}
      {selection && capabilities.selection ? (
        <GraphSelectionCard
          nodeId={selection.nodeId}
          nodes={nodes}
          onOpen={onOpenNode}
          onClose={onClearSelection}
          canFocus={capabilities.focus}
          onFocus={
            capabilities.focus && controls ? () => controls.focusNode(selection.nodeId) : undefined
          }
        />
      ) : null}
    </>
  );
}

import type { CanvasEdge, CanvasNode, CanvasProjectionKind, KbLinkMode } from "@kb/canvas";
import { SlidersHorizontalIcon } from "@phosphor-icons/react";
import { CanvasToolbar } from "./canvas-toolbar";
import { EdgeInspector } from "./edge-inspector";
import { NodePicker } from "./node-picker";
import { ItemInspector } from "./item-inspector";
import type { CanvasSelection } from "./canvas-selection";
import { selectionEmpty } from "./canvas-selection";
import type { CanvasTool, ToolState } from "./canvas-tool";
import { GIZMO_MODES, type GizmoChoice } from "./canvas-gizmo";
import { cn } from "@/sdk";

interface CanvasOverlaysProps {
  projection: CanvasProjectionKind;
  onProjectionChange: (projection: CanvasProjectionKind) => void;
  selection: CanvasSelection;
  toolState: ToolState;
  selectedEdge: CanvasEdge | null;
  selectedItem: CanvasNode | null;
  inspectorAnchor: { x: number; y: number } | null;
  itemInspectorAnchor: { x: number; y: number } | null;
  pickerOpen: boolean;
  refFields: { id: string; name: string; isRef: boolean }[];
  onToolChange: (tool: CanvasTool) => void;
  onToolDoubleClick: (tool: CanvasTool) => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onDeleteSelection: () => void;
  onCloseEdgeInspector: () => void;
  onEdgeModeChange: (mode: KbLinkMode) => void;
  onEdgeFieldChange: (fieldId: string) => void;
  onDeleteEdge: () => void;
  onEdgeChange: (edge: CanvasEdge) => void;
  onCloseItemInspector: () => void;
  /** Open the selected item's inspector at a point on screen. */
  onInspectItem: (anchor: { x: number; y: number }) => void;
  onItemChange: (shape: CanvasNode) => void;
  onPickNode: (nodeId: string) => void;
  onClosePicker: () => void;
  /** The 3D gizmo's choice, which the selection toolbar switches; null where there is no gizmo (2D). */
  gizmo: GizmoChoice | null;
  onGizmoChange: (choice: GizmoChoice) => void;
}

/** One of the toolbar's switch buttons: lit while it is the one chosen. */
const switchClass = (on: boolean) =>
  cn(
    "rounded-md px-1.5 py-1 text-label",
    on ? "bg-primary/15 text-primary" : "text-foreground/60 hover:bg-foreground/5",
  );

/**
 * The gizmo's switches: which transform its handles make (the last one
 * chosen stays), and whether they run along the canvas's axes or the
 * selection's own.
 */
function GizmoSwitches({
  gizmo,
  onGizmoChange,
}: {
  gizmo: GizmoChoice;
  onGizmoChange: (choice: GizmoChoice) => void;
}) {
  const local = gizmo.space === "local";
  return (
    <>
      <div className="flex items-center gap-0.5" role="group" aria-label="Gizmo">
        {GIZMO_MODES.map(({ mode, label }) => (
          <button
            key={mode}
            type="button"
            aria-pressed={gizmo.mode === mode}
            className={switchClass(gizmo.mode === mode)}
            onClick={() => onGizmoChange({ ...gizmo, mode })}
          >
            {label}
          </button>
        ))}
      </div>
      <button
        type="button"
        aria-pressed={local}
        title={
          local
            ? "Along the selection's own axes"
            : "Along the canvas's axes (X red, Y green, Z blue)"
        }
        className={switchClass(local)}
        onClick={() => onGizmoChange({ ...gizmo, space: local ? "global" : "local" })}
      >
        {local ? "Local" : "Global"}
      </button>
      <div className="mx-1 h-4 w-px bg-foreground/10" />
    </>
  );
}

/** The floating selection toolbar: in 3D the gizmo's switches, then inspect one item, reorder, delete. */
function SelectionBar({
  count,
  canInspect,
  gizmo,
  onGizmoChange,
  onInspectItem,
  onBringToFront,
  onSendToBack,
  onDeleteSelection,
}: {
  count: number;
  canInspect: boolean;
} & Pick<
  CanvasOverlaysProps,
  | "gizmo"
  | "onGizmoChange"
  | "onInspectItem"
  | "onBringToFront"
  | "onSendToBack"
  | "onDeleteSelection"
>) {
  return (
    <div className="absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-foreground/10 bg-popover/95 px-2 py-1.5 shadow-floating backdrop-blur-sm">
      <span className="mr-1 text-label text-foreground/40">{count} selected</span>
      {gizmo !== null && <GizmoSwitches gizmo={gizmo} onGizmoChange={onGizmoChange} />}
      {canInspect && (
        <button
          type="button"
          title="Inspect: colour, height and rotation"
          aria-label="Inspect"
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-label text-foreground/60 hover:bg-foreground/5"
          onClick={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            // The inspector stands centred over the button (it opens 160px left of its anchor).
            onInspectItem({ x: box.left + box.width / 2 + 16, y: box.top });
          }}
        >
          <SlidersHorizontalIcon size={13} />
          Inspect
        </button>
      )}
      <button
        type="button"
        title="Bring to front"
        className="rounded-md px-1.5 py-1 text-label text-foreground/60 hover:bg-foreground/5"
        onClick={onBringToFront}
      >
        ↑ Front
      </button>
      <button
        type="button"
        title="Send to back"
        className="rounded-md px-1.5 py-1 text-label text-foreground/60 hover:bg-foreground/5"
        onClick={onSendToBack}
      >
        ↓ Back
      </button>
      <div className="mx-1 h-4 w-px bg-foreground/10" />
      <button
        type="button"
        title="Delete selected (Del)"
        className="rounded-md px-1.5 py-1 text-label text-destructive hover:bg-destructive/10"
        onClick={onDeleteSelection}
      >
        Delete
      </button>
    </div>
  );
}

export function CanvasOverlays({
  projection,
  onProjectionChange,
  selection,
  toolState,
  selectedEdge,
  selectedItem,
  inspectorAnchor,
  itemInspectorAnchor,
  pickerOpen,
  refFields,
  onToolChange,
  onToolDoubleClick,
  onBringToFront,
  onSendToBack,
  onDeleteSelection,
  onCloseEdgeInspector,
  onEdgeModeChange,
  onEdgeFieldChange,
  onDeleteEdge,
  onEdgeChange,
  onCloseItemInspector,
  onInspectItem,
  onItemChange,
  onPickNode,
  onClosePicker,
  gizmo,
  onGizmoChange,
}: CanvasOverlaysProps) {
  return (
    <>
      <CanvasToolbar
        projection={projection}
        onProjectionChange={onProjectionChange}
        toolState={toolState}
        onToolChange={onToolChange}
        onToolDoubleClick={onToolDoubleClick}
      />

      {!selectionEmpty(selection) && !inspectorAnchor && !itemInspectorAnchor && (
        <SelectionBar
          count={selection.nodeIds.size + selection.edgeIds.size}
          canInspect={selectedItem !== null}
          gizmo={selection.nodeIds.size > 0 ? gizmo : null}
          onGizmoChange={onGizmoChange}
          onInspectItem={onInspectItem}
          onBringToFront={onBringToFront}
          onSendToBack={onSendToBack}
          onDeleteSelection={onDeleteSelection}
        />
      )}

      {selectedEdge && inspectorAnchor && (
        <EdgeInspector
          edge={selectedEdge}
          anchor={inspectorAnchor}
          refFields={refFields}
          onClose={onCloseEdgeInspector}
          onModeChange={onEdgeModeChange}
          onFieldChange={onEdgeFieldChange}
          onDelete={onDeleteEdge}
          onArrowChange={(end, value) => onEdgeChange({ ...selectedEdge, [end]: value })}
          onColorChange={(color) => {
            const updated = { ...selectedEdge };
            if (color === undefined) delete updated.color;
            else updated.color = color;
            onEdgeChange(updated);
          }}
          onLabelChange={(label) => {
            const updated = { ...selectedEdge, label: label || undefined };
            if (!label) delete updated.label;
            onEdgeChange(updated);
          }}
        />
      )}

      {selectedItem && itemInspectorAnchor && (
        <ItemInspector
          item={selectedItem}
          anchor={itemInspectorAnchor}
          onClose={onCloseItemInspector}
          onChange={onItemChange}
        />
      )}

      {pickerOpen && <NodePicker onPick={onPickNode} onClose={onClosePicker} />}
    </>
  );
}

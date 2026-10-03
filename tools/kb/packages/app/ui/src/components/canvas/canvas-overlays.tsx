import type { CanvasEdge, CanvasNode, CanvasProjectionKind, KbLinkMode } from "@kb/canvas";
import { SlidersHorizontalIcon } from "@phosphor-icons/react";
import { CanvasToolbar } from "./canvas-toolbar";
import { EdgeInspector } from "./edge-inspector";
import { NodePicker } from "./node-picker";
import { ItemInspector } from "./item-inspector";
import type { CanvasSelection } from "./canvas-selection";
import { selectionEmpty } from "./canvas-selection";
import type { CanvasTool, ToolState } from "./canvas-tool";

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
}

/** The floating selection toolbar: inspect one item, reorder, delete. */
function SelectionBar({
  count,
  canInspect,
  onInspectItem,
  onBringToFront,
  onSendToBack,
  onDeleteSelection,
}: {
  count: number;
  canInspect: boolean;
} & Pick<
  CanvasOverlaysProps,
  "onInspectItem" | "onBringToFront" | "onSendToBack" | "onDeleteSelection"
>) {
  return (
    <div className="absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-foreground/10 bg-popover/95 px-2 py-1.5 shadow-floating backdrop-blur-sm">
      <span className="mr-1 text-label text-foreground/40">{count} selected</span>
      {canInspect && (
        <button
          type="button"
          title="Inspect: colour, lift and depth"
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

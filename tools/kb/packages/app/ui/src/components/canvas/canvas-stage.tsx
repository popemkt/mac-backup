import type { CanvasDoc, CanvasEdge, CanvasNode, CanvasSide } from "@kb/canvas";
import { CanvasCardLayer } from "./canvas-card-layer";
import { CanvasEdgeLayer } from "./canvas-edge-layer";
import type { CanvasSelection } from "./canvas-selection";
import type { PointerResult, PointerState, ResizeCorner } from "./canvas-pointer";
import type { ToolState } from "./canvas-tool";
import { GRID_STEP } from "./canvas-snap";
import { cn, type OutlineNode } from "@kb/ui-sdk";

interface CanvasStageProps {
  doc: CanvasDoc;
  nodes: Map<string, OutlineNode>;
  byId: Map<string, CanvasNode>;
  selection: CanvasSelection;
  pan: { x: number; y: number };
  zoom: number;
  spaceDown: boolean;
  toolState: ToolState;
  editingEdgeLabel: string | null;
  edgeDrag: Extract<NonNullable<PointerState["drag"]>, { kind: "edge" }> | null;
  snapGuides: PointerResult["guides"];
  marqueeRect: PointerState["marqueeRect"];
  onEditingEdgeLabelChange: (edgeId: string | null) => void;
  onEdgeLabelCommit: (edge: CanvasEdge, label: string) => void;
  onCardSelect: (card: CanvasNode, anchor?: { x: number; y: number }) => void;
  onCardChange: (card: CanvasNode) => void;
  onResizeStart: (cardId: string, corner: ResizeCorner, screen: { x: number; y: number }) => void;
  onRotateStart: (cardId: string, screen: { x: number; y: number }) => void;
  onPortDown: (cardId: string, side: CanvasSide, screen: { x: number; y: number }) => void;
  onWheel: (event: React.WheelEvent<HTMLDivElement>) => void;
  onPointerDownStage: (event: React.PointerEvent<HTMLDivElement>) => void;
  /** A press during a modal transform, which only ends it; whether it was one. */
  onModalPress: (event: React.PointerEvent<HTMLDivElement>) => boolean;
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: () => void;
  onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
  onDoubleClickStage: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleCardPointerDown: (
    card: CanvasNode,
    event: React.PointerEvent,
    anchor?: { x: number; y: number },
  ) => void;
  handleEdgeClick: (edge: CanvasEdge, event: React.MouseEvent) => void;
  /** The item being edited, or null. */
  editing: string | null;
  /** An item's editor opened or closed. */
  onEdit: (id: string, editing: boolean) => void;
}

/** The guides across the floor, which the top view draws; a guide up the z axis has no line here. */
function CanvasSnapGuides({ guides }: { guides: PointerResult["guides"] }) {
  return (
    <>
      {guides.map((guide) =>
        guide.axis === "z" ? null : (
          <div
            key={guide.axis}
            className={cn(
              "absolute border-dashed border-primary/40",
              guide.axis === "x" ? "border-l" : "border-t",
            )}
            style={
              guide.axis === "x"
                ? { left: guide.pos, top: -4000, height: 8000, pointerEvents: "none" }
                : { top: guide.pos, left: -4000, width: 8000, pointerEvents: "none" }
            }
          />
        ),
      )}
    </>
  );
}

export function CanvasStage({
  doc,
  nodes,
  byId,
  selection,
  pan,
  zoom,
  spaceDown,
  toolState,
  editingEdgeLabel,
  edgeDrag,
  snapGuides,
  marqueeRect,
  onEditingEdgeLabelChange,
  onEdgeLabelCommit,
  onCardSelect,
  onCardChange,
  onResizeStart,
  onRotateStart,
  onPortDown,
  onWheel,
  onPointerDownStage,
  onModalPress,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onDoubleClickStage,
  handleCardPointerDown,
  handleEdgeClick,
  editing,
  onEdit,
}: CanvasStageProps) {
  return (
    <div
      data-canvas-viewport
      className={cn(
        "relative min-h-0 flex-1 overflow-hidden",
        spaceDown
          ? "cursor-grab"
          : toolState.tool !== "select"
            ? "cursor-crosshair"
            : "cursor-default",
      )}
      style={{
        backgroundImage:
          "radial-gradient(circle, color-mix(in oklab, var(--foreground) 4%, transparent) 1px, transparent 1px)",
        backgroundSize: `${GRID_STEP * zoom}px ${GRID_STEP * zoom}px`,
        backgroundPosition: `${pan.x}px ${pan.y}px`,
      }}
      onWheel={onWheel}
      onPointerDownCapture={(event) => {
        if (onModalPress(event)) return;
        if (event.button === 1 || spaceDown || (event.button === 0 && event.altKey)) {
          event.preventDefault();
          event.stopPropagation();
          onPointerDownStage(event);
        }
      }}
      onPointerDown={onPointerDownStage}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={onDoubleClickStage}
    >
      <div
        className="absolute inset-0 origin-top-left"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        }}
      >
        <CanvasEdgeLayer
          doc={doc}
          nodes={nodes}
          byId={byId}
          selection={selection}
          pan={pan}
          zoom={zoom}
          editingEdgeLabel={editingEdgeLabel}
          edgeDrag={edgeDrag}
          onEditingEdgeLabelChange={onEditingEdgeLabelChange}
          onEdgeLabelCommit={onEdgeLabelCommit}
          onEdgeClick={handleEdgeClick}
        />

        <CanvasSnapGuides guides={snapGuides} />

        {/* Marquee selection rectangle */}
        {marqueeRect && (
          <div
            className="absolute border border-primary/40 bg-primary/10"
            style={{
              left: Math.min(marqueeRect.x, marqueeRect.x + marqueeRect.w),
              top: Math.min(marqueeRect.y, marqueeRect.y + marqueeRect.h),
              width: Math.abs(marqueeRect.w),
              height: Math.abs(marqueeRect.h),
              pointerEvents: "none",
            }}
          />
        )}

        <CanvasCardLayer
          doc={doc}
          selection={selection}
          onCardSelect={onCardSelect}
          onCardChange={onCardChange}
          onResizeStart={onResizeStart}
          onRotateStart={onRotateStart}
          onPortDown={onPortDown}
          onCardPointerDown={handleCardPointerDown}
          editing={editing}
          onEdit={onEdit}
        />
      </div>
    </div>
  );
}

import type { CanvasDoc, CanvasEdge, CanvasNode, CanvasSide } from "@kb/canvas";
import { CanvasCardLayer } from "@/components/canvas/canvas-card-layer";
import { CanvasEdgeLayer } from "@/components/canvas/canvas-edge-layer";
import type { CanvasSelection } from "@/lib/canvas-selection";
import type { PointerResult, PointerState, ResizeCorner } from "@/lib/canvas-pointer";
import type { ToolState } from "@/lib/canvas-tool";
import type { OutlineNode } from "@/lib/types";
import { cn } from "@/lib/cn";

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
  onPortDown: (cardId: string, side: CanvasSide, screen: { x: number; y: number }) => void;
  onWheel: (event: React.WheelEvent<HTMLDivElement>) => void;
  onPointerDownStage: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
  onDoubleClickStage: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleCardPointerDown: (
    card: CanvasNode,
    event: React.PointerEvent,
    anchor?: { x: number; y: number },
  ) => void;
  handleEdgeClick: (edge: CanvasEdge, event: React.MouseEvent) => void;
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
  onPortDown,
  onWheel,
  onPointerDownStage,
  onPointerMove,
  onPointerUp,
  onDoubleClickStage,
  handleCardPointerDown,
  handleEdgeClick,
}: CanvasStageProps) {
  return (
    <div
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
        backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
        backgroundPosition: `${pan.x}px ${pan.y}px`,
      }}
      onWheel={onWheel}
      onPointerDown={onPointerDownStage}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
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

        {/* Alignment snap guides */}
        {snapGuides.map((g, i) =>
          g.axis === "x" ? (
            <div
              // oxlint-disable-next-line react/no-array-index-key -- GAP [[01M1MFP33RDP5MVB4827DR5RE7]]
              key={`sg-${i}`}
              className="absolute border-l border-dashed border-primary/40"
              style={{ left: g.pos, top: -4000, height: 8000, pointerEvents: "none" }}
            />
          ) : (
            <div
              // oxlint-disable-next-line react/no-array-index-key -- GAP [[01M1MFP33RDP5MVB4827DR5RE7]]
              key={`sg-${i}`}
              className="absolute border-t border-dashed border-primary/40"
              style={{ top: g.pos, left: -4000, width: 8000, pointerEvents: "none" }}
            />
          ),
        )}

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
          onPortDown={onPortDown}
          onCardPointerDown={handleCardPointerDown}
        />
      </div>
    </div>
  );
}

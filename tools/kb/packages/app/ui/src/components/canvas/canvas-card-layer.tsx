import type { CanvasDoc, CanvasNode, CanvasSide } from "@kb/canvas";
import { isGroupNode, isKbNode, isShapeNode, isTextNode } from "@kb/canvas";
import { KbNodeCard, TextCard } from "@/components/canvas/canvas-card";
import { ShapeCard } from "@/components/canvas/shape-card";
import type { CanvasSelection } from "@/lib/canvas-selection";
import type { ResizeCorner } from "@/lib/canvas-pointer";
import { classifyCardPointer } from "@/lib/card-pointer";
import { hasText } from "@/lib/text";
import { cn } from "@/lib/cn";
import { CanvasPorts } from "./canvas-ports";
import { CanvasResizeHandles } from "./canvas-resize-handles";

interface CanvasCardLayerProps {
  doc: CanvasDoc;
  selection: CanvasSelection;
  onCardSelect: (card: CanvasNode, anchor?: { x: number; y: number }) => void;
  onCardChange: (card: CanvasNode) => void;
  onResizeStart: (cardId: string, corner: ResizeCorner, screen: { x: number; y: number }) => void;
  onPortDown: (cardId: string, side: CanvasSide, screen: { x: number; y: number }) => void;
  onCardPointerDown: (
    card: CanvasNode,
    event: React.PointerEvent,
    anchor?: { x: number; y: number },
  ) => void;
}

type CanvasCardViewProps = Omit<CanvasCardLayerProps, "doc"> & { card: CanvasNode };

function CanvasCardView({
  card,
  selection,
  onCardSelect,
  onCardChange,
  onResizeStart,
  onPortDown,
  onCardPointerDown: handleCardPointerDown,
}: CanvasCardViewProps) {
  const resizeHandler = (event: React.PointerEvent, corner: ResizeCorner) => {
    onResizeStart(card.id, corner, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const portHandler = (cardId: string) => (side: CanvasSide, event: React.PointerEvent) => {
    onPortDown(cardId, side, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const isSelected = selection.nodeIds.has(card.id);

  if (isGroupNode(card)) {
    return (
      <div
        key={card.id}
        data-card-id={card.id}
        className={cn(
          "group/card absolute rounded-md border border-dashed bg-foreground/[0.02]",
          isSelected ? "border-primary/40" : "border-foreground/10",
        )}
        style={{
          left: card.x,
          top: card.y,
          width: card.width,
          height: card.height,
        }}
        onPointerDown={(e) => {
          if (classifyCardPointer(e.target, undefined) === "chrome") return;
          e.stopPropagation();
          handleCardPointerDown(card, e);
        }}
      >
        {hasText(card.label) && (
          <div className="px-2 py-1 text-[11px] text-foreground/40">{card.label}</div>
        )}
        <CanvasResizeHandles selected={isSelected} onResizeStart={resizeHandler} />
        <CanvasPorts onPortDown={portHandler(card.id)} />
      </div>
    );
  }
  if (isTextNode(card)) {
    return (
      <div key={card.id} data-card-id={card.id}>
        <TextCard
          card={card}
          selected={isSelected}
          onSelect={() => {
            if (!selection.nodeIds.has(card.id)) {
              onCardSelect(card);
            }
          }}
          onChange={(text) => onCardChange({ ...card, text })}
          onMoveStart={(e) => {
            handleCardPointerDown(card, e);
          }}
          onResizeStart={resizeHandler}
          onPortDown={portHandler(card.id)}
        />
      </div>
    );
  }
  if (isShapeNode(card)) {
    return (
      <div key={card.id} data-card-id={card.id}>
        <ShapeCard
          card={card}
          selected={isSelected}
          onSelect={(anchor) => {
            if (!selection.nodeIds.has(card.id)) {
              onCardSelect(card, anchor);
            }
          }}
          onLabelChange={(label) => onCardChange({ ...card, label })}
          onMoveStart={(e) => {
            handleCardPointerDown(card, e, {
              x: e.clientX,
              y: e.clientY,
            });
          }}
          onResizeStart={resizeHandler}
          onPortDown={portHandler(card.id)}
        />
      </div>
    );
  }
  if (!isKbNode(card)) {
    return (
      <div
        key={card.id}
        data-card-id={card.id}
        className={cn(
          "group/card absolute rounded-md border bg-background px-2 py-1 text-[11px] text-foreground/40",
          isSelected ? "border-primary/40" : "border-foreground/[0.06]",
        )}
        style={{
          left: card.x,
          top: card.y,
          width: card.width,
          height: card.height,
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          handleCardPointerDown(card, e);
        }}
      >
        {card.type}
        <CanvasResizeHandles selected={isSelected} onResizeStart={resizeHandler} />
        <CanvasPorts onPortDown={portHandler(card.id)} />
      </div>
    );
  }
  return (
    <div key={card.id} data-card-id={card.id}>
      <KbNodeCard
        card={card}
        selected={isSelected}
        onSelect={() => {
          if (!selection.nodeIds.has(card.id)) {
            onCardSelect(card);
          }
        }}
        onMoveStart={(e) => {
          handleCardPointerDown(card, e);
        }}
        onResizeStart={resizeHandler}
        onPortDown={portHandler(card.id)}
      />
    </div>
  );
}

export function CanvasCardLayer(props: CanvasCardLayerProps) {
  return (
    <div data-canvas-stage className="contents">
      {props.doc.nodes.map((card) => (
        <CanvasCardView key={card.id} {...props} card={card} />
      ))}
    </div>
  );
}
